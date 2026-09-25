// Simulation building blocks (SPEC §7.5): the level 1 request, level 2 calldata, and parsing of
// what comes back. Pure; the Effect program in features/simulation runs them over RPC.
import {
  type Address,
  decodeAbiParameters,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  type Hex,
  hexToBigInt,
  type Log,
  parseAbi,
  type StateOverride,
  size,
  sliceHex,
} from 'viem'
import { execTransactionData, executionOutcome, translateRevert } from './execution'
import { SLOT, slot, word } from './safe-layout'
import type { SafeTx } from './safe-tx'
import { prevalidatedSignature } from './signatures'

/**
 * Level 1: the real execTransaction, sent from one current owner with a pre-validated signature,
 * on a Safe whose threshold is overridden to 1 and nonce to the transaction's. So it runs
 * before anyone signs, delegatecall and MultiSend included.
 */
export function level1Request(safe: Address, tx: SafeTx, owner: Address) {
  const stateOverrides: StateOverride = [
    {
      address: safe,
      stateDiff: [
        { slot: slot(SLOT.threshold), value: word(1) },
        { slot: slot(SLOT.nonce), value: word(tx.nonce) },
      ],
    },
  ]
  return {
    call: { from: owner, to: safe, data: execTransactionData(tx, prevalidatedSignature(owner)) },
    stateOverrides,
  }
}

export type Outcome =
  | { readonly ok: true; readonly gasUsed: bigint }
  | { readonly ok: false; readonly gasUsed?: bigint; readonly reason: string }

/** Read a level 1 call result: a revert, an ExecutionFailure event, or success. */
export function level1Outcome(
  call: {
    status: 'success' | 'failure'
    data: Hex
    gasUsed: bigint
    logs?: readonly Log[] | undefined
  },
  safe: Address,
  safeTxHash: Hex,
): Outcome {
  if (call.status === 'failure')
    return { ok: false, gasUsed: call.gasUsed, reason: translateRevert(call.data) }
  // With safeTxGas or gasPrice set, a failing inner call doesn't revert execTransaction: the
  // Safe emits ExecutionFailure, uses up the nonce and still pays the refund.
  if (executionOutcome(call.logs ?? [], safe, safeTxHash) === 'failed')
    return {
      ok: false,
      gasUsed: call.gasUsed,
      reason:
        'The call inside this Safe transaction fails. Because safeTxGas or gasPrice is set, the Safe records it as failed, uses up the nonce and still pays the refund.',
    }
  return { ok: true, gasUsed: call.gasUsed }
}

const storageAccessibleAbi = parseAbi([
  'function simulateAndRevert(address targetContract, bytes calldataPayload)',
])
const accessorAbi = parseAbi([
  'function simulate(address to, uint256 value, bytes data, uint8 operation) returns (uint256 estimate, bool success, bytes returnData)',
])

/** Level 2: the Safe delegatecalls SimulateTxAccessor.simulate and reverts with the result. */
export function level2Data(accessor: Address, tx: SafeTx): Hex {
  return encodeFunctionData({
    abi: storageAccessibleAbi,
    functionName: 'simulateAndRevert',
    args: [
      accessor,
      encodeFunctionData({
        abi: accessorAbi,
        functionName: 'simulate',
        args: [tx.to, tx.value, tx.data, tx.operation],
      }),
    ],
  })
}

/**
 * simulateAndRevert reverts with `success ‖ returndatasize ‖ returndata`, where returndata is
 * simulate()'s `(estimate, success, returnData)`. Undefined when the data has another shape
 * (for example, the delegatecall itself failed).
 */
export function level2Outcome(revert: Hex | undefined): Outcome | undefined {
  if (!revert || size(revert) < 64) return undefined
  if (hexToBigInt(sliceHex(revert, 0, 32)) !== 1n) return undefined
  const length = Number(hexToBigInt(sliceHex(revert, 32, 64)))
  if (size(revert) < 64 + length || length === 0) return undefined
  try {
    const [estimate, success, returnData] = decodeAbiParameters(
      [{ type: 'uint256' }, { type: 'bool' }, { type: 'bytes' }],
      sliceHex(revert, 64, 64 + length),
    )
    return success
      ? { ok: true, gasUsed: estimate }
      : { ok: false, gasUsed: estimate, reason: translateRevert(returnData) }
  } catch {
    return undefined
  }
}

/** traceTransfers reports native ETH movements as Transfer logs from this address. */
export const NATIVE_PSEUDO_TOKEN: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const transferAbi = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])
const nftTransferAbi = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
])
const erc1155Abi = parseAbi([
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
])

export type BalanceChange =
  | { readonly kind: 'native'; readonly delta: bigint }
  | { readonly kind: 'erc20'; readonly token: Address; readonly delta: bigint }
  | {
      readonly kind: 'erc721'
      readonly token: Address
      readonly id: bigint
      readonly delta: bigint
    }
  | {
      readonly kind: 'erc1155'
      readonly token: Address
      readonly id: bigint
      readonly delta: bigint
    }

const tryDecode = <T>(f: () => T): T | undefined => {
  try {
    return f()
  } catch {
    return undefined
  }
}

/**
 * The Safe's balance changes from simulation logs, netted per token (and per token ID for
 * NFTs): ERC-20 and ERC-721 Transfer, ERC-1155 TransferSingle/TransferBatch, and native ETH
 * from traceTransfers.
 */
export function balanceChanges(logs: readonly Log[], safe: Address): BalanceChange[] {
  const me = safe.toLowerCase()
  const net = new Map<string, BalanceChange>()
  const add = (c: BalanceChange, from: string, to: string) => {
    const sign = (to.toLowerCase() === me ? 1n : 0n) - (from.toLowerCase() === me ? 1n : 0n)
    if (sign === 0n) return
    const key =
      c.kind === 'native'
        ? 'native'
        : `${c.kind}:${c.token.toLowerCase()}${'id' in c ? `:${c.id}` : ''}`
    const prev = net.get(key)
    net.set(key, { ...c, delta: (prev?.delta ?? 0n) + sign * c.delta })
  }
  for (const log of logs) {
    const topics = log.topics as [Hex, ...Hex[]]
    const token = getAddress(log.address)
    if (topics.length === 3) {
      const e = tryDecode(() => decodeEventLog({ abi: transferAbi, data: log.data, topics }))
      if (e) {
        const { from, to, value } = e.args
        if (token === NATIVE_PSEUDO_TOKEN) add({ kind: 'native', delta: value }, from, to)
        else add({ kind: 'erc20', token, delta: value }, from, to)
        continue
      }
    }
    if (topics.length === 4) {
      const e = tryDecode(() => decodeEventLog({ abi: nftTransferAbi, data: log.data, topics }))
      if (e) {
        add({ kind: 'erc721', token, id: e.args.tokenId, delta: 1n }, e.args.from, e.args.to)
        continue
      }
      const m = tryDecode(() => decodeEventLog({ abi: erc1155Abi, data: log.data, topics }))
      if (m?.eventName === 'TransferSingle')
        add({ kind: 'erc1155', token, id: m.args.id, delta: m.args.value }, m.args.from, m.args.to)
      else if (m?.eventName === 'TransferBatch')
        m.args.ids.forEach((id, i) => {
          add({ kind: 'erc1155', token, id, delta: m.args.values[i] ?? 0n }, m.args.from, m.args.to)
        })
    }
  }
  const order = { native: 0, erc20: 1, erc721: 2, erc1155: 3 }
  return [...net.values()]
    .filter((c) => c.delta !== 0n)
    .sort(
      (a, b) =>
        order[a.kind] - order[b.kind] ||
        ('token' in a && 'token' in b ? a.token.localeCompare(b.token) : 0),
    )
}

const knownEvents = parseAbi([
  'event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)',
  'event ExecutionFailure(bytes32 indexed txHash, uint256 payment)',
  'event SafeMultiSigTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures, bytes additionalInfo)',
  'event AddedOwner(address indexed owner)',
  'event RemovedOwner(address indexed owner)',
  'event ChangedThreshold(uint256 threshold)',
  'event EnabledModule(address indexed module)',
  'event DisabledModule(address indexed module)',
  'event ChangedGuard(address indexed guard)',
  'event ChangedModuleGuard(address indexed moduleGuard)',
  'event ChangedFallbackHandler(address indexed handler)',
  'event ApproveHash(bytes32 indexed approvedHash, address indexed owner)',
  'event SafeReceived(address indexed sender, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'event ApprovalForAll(address indexed owner, address indexed operator, bool approved)',
  'event Deposit(address indexed dst, uint256 wad)',
  'event Withdrawal(address indexed src, uint256 wad)',
])
// v1.3.0's ExecutionSuccess/Failure and owner events aren't indexed (SPEC §4.1)
const knownEventsV130 = parseAbi([
  'event ExecutionSuccess(bytes32 txHash, uint256 payment)',
  'event ExecutionFailure(bytes32 txHash, uint256 payment)',
  'event AddedOwner(address owner)',
  'event RemovedOwner(address owner)',
  'event EnabledModule(address module)',
  'event DisabledModule(address module)',
  'event ChangedFallbackHandler(address handler)',
])

export interface SimEvent {
  readonly address: Address
  /** The event name, when a known ABI decodes it. */
  readonly name?: string
  readonly topic0?: Hex
}

/** Names for the events a simulation emitted; native pseudo-logs are left out. */
export function describeEvents(logs: readonly Log[]): SimEvent[] {
  return logs
    .filter((l) => getAddress(l.address) !== NATIVE_PSEUDO_TOKEN)
    .map((l) => {
      const topics = l.topics as [Hex, ...Hex[]]
      const name = [knownEvents, knownEventsV130, transferAbi, nftTransferAbi, erc1155Abi]
        .map((abi) => tryDecode(() => decodeEventLog({ abi, data: l.data, topics }).eventName))
        .find((n) => n !== undefined)
      return {
        address: getAddress(l.address),
        ...(name ? { name } : {}),
        ...(topics[0] ? { topic0: topics[0] } : {}),
      }
    })
}
