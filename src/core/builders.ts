// Builder presets (SPEC §3.3). Every one produces a SafeTx. The builder never produces a
// delegatecall except MultiSend batches (P1).
import { type Address, encodeFunctionData, erc20Abi, getAddress, parseAbi, zeroAddress } from 'viem'
import { SENTINEL } from './safe-layout'
import type { SafeTx } from './safe-tx'

export const ownerManagerAbi = parseAbi([
  'function addOwnerWithThreshold(address owner, uint256 _threshold)',
  'function removeOwner(address prevOwner, address owner, uint256 _threshold)',
  'function swapOwner(address prevOwner, address oldOwner, address newOwner)',
  'function changeThreshold(uint256 _threshold)',
])

/** The parts a preset decides; the rest defaults to zero (SPEC §3.3 advanced fields). */
export type TxCall = Pick<SafeTx, 'to' | 'value' | 'data' | 'operation'>

export function completeTx(call: TxCall, nonce: bigint): SafeTx {
  return {
    ...call,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce,
  }
}

/** Next free nonce: max(on-chain nonce, highest queued nonce + 1) (SPEC §3.3). */
export function nextNonce(onchainNonce: bigint, queued: readonly bigint[]): bigint {
  const highest = queued.reduce((m, n) => (n > m ? n : m), -1n)
  return highest + 1n > onchainNonce ? highest + 1n : onchainNonce
}

export const sendNative = (to: Address, value: bigint): TxCall => ({
  to: getAddress(to),
  value,
  data: '0x',
  operation: 0,
})

export const sendErc20 = (token: Address, to: Address, amount: bigint): TxCall => ({
  to: getAddress(token),
  value: 0n,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [getAddress(to), amount],
  }),
  operation: 0,
})

export const contractCall = (to: Address, value: bigint, data: `0x${string}`): TxCall => ({
  to: getAddress(to),
  value,
  data,
  operation: 0,
})

/** The owner before `owner` in the linked list, as `getOwners()` orders it (SPEC §3.3). */
export function prevOwner(owners: readonly Address[], owner: Address): Address {
  const i = owners.findIndex((o) => o.toLowerCase() === owner.toLowerCase())
  if (i < 0) throw new Error(`${owner} is not an owner`)
  return i === 0 ? SENTINEL : (owners[i - 1] as Address)
}

export type OwnerChange =
  | { readonly kind: 'add'; readonly owner: Address; readonly threshold: bigint }
  | { readonly kind: 'remove'; readonly owner: Address; readonly threshold: bigint }
  | { readonly kind: 'swap'; readonly oldOwner: Address; readonly newOwner: Address }
  | { readonly kind: 'threshold'; readonly threshold: bigint }

/** Owners and threshold after the change, for validation and the before → after view (§7.4). */
export function applyOwnerChange(
  owners: readonly Address[],
  threshold: bigint,
  change: OwnerChange,
): { owners: Address[]; threshold: bigint } {
  switch (change.kind) {
    case 'add':
      return { owners: [getAddress(change.owner), ...owners], threshold: change.threshold }
    case 'remove':
      return {
        owners: owners.filter((o) => o.toLowerCase() !== change.owner.toLowerCase()),
        threshold: change.threshold,
      }
    case 'swap':
      return {
        owners: owners.map((o) =>
          o.toLowerCase() === change.oldOwner.toLowerCase() ? getAddress(change.newOwner) : o,
        ),
        threshold,
      }
    case 'threshold':
      return { owners: [...owners], threshold: change.threshold }
  }
}

/** Problems the Safe itself would reject (GS2xx), caught before building. */
export function ownerChangeProblem(
  safe: Address,
  owners: readonly Address[],
  threshold: bigint,
  change: OwnerChange,
): string | undefined {
  const isOwner = (a: Address) => owners.some((o) => o.toLowerCase() === a.toLowerCase())
  const badNew = (a: Address) =>
    a === zeroAddress || a.toLowerCase() === SENTINEL || a.toLowerCase() === safe.toLowerCase()
      ? 'This address cannot be an owner.'
      : isOwner(a)
        ? 'This address is already an owner.'
        : undefined
  if (change.kind === 'add') {
    const p = badNew(change.owner)
    if (p) return p
  }
  if (change.kind === 'remove' && !isOwner(change.owner)) return 'Not an owner.'
  if (change.kind === 'swap') {
    if (!isOwner(change.oldOwner)) return 'Not an owner.'
    const p = badNew(change.newOwner)
    if (p) return p
  }
  const after = applyOwnerChange(owners, threshold, change)
  if (after.owners.length === 0) return 'A Safe needs at least one owner.'
  if (after.threshold < 1n) return 'The threshold must be at least 1.'
  if (after.threshold > BigInt(after.owners.length)) {
    return `The threshold can't be more than the number of owners (${after.owners.length}).`
  }
  return undefined
}

/** The call on the Safe itself, with operation 0 (SPEC §3.3). */
export function ownerChangeCall(
  safe: Address,
  owners: readonly Address[],
  change: OwnerChange,
): TxCall {
  const data = (() => {
    switch (change.kind) {
      case 'add':
        return encodeFunctionData({
          abi: ownerManagerAbi,
          functionName: 'addOwnerWithThreshold',
          args: [getAddress(change.owner), change.threshold],
        })
      case 'remove':
        return encodeFunctionData({
          abi: ownerManagerAbi,
          functionName: 'removeOwner',
          args: [prevOwner(owners, change.owner), getAddress(change.owner), change.threshold],
        })
      case 'swap':
        return encodeFunctionData({
          abi: ownerManagerAbi,
          functionName: 'swapOwner',
          args: [
            prevOwner(owners, change.oldOwner),
            getAddress(change.oldOwner),
            getAddress(change.newOwner),
          ],
        })
      case 'threshold':
        return encodeFunctionData({
          abi: ownerManagerAbi,
          functionName: 'changeThreshold',
          args: [change.threshold],
        })
    }
  })()
  return { to: getAddress(safe), value: 0n, data, operation: 0 }
}
