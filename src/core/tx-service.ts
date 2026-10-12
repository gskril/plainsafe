// Safe Transaction Service interop (SPEC §3.15, §8.2). Pure: the chain table, URLs, turning a
// service record into a package, reading Safe{Wallet} links, and what to post. Everything from
// the service is untrusted and goes through verifyPackage like any shared package.

import { Either, Schema } from 'effect'
import { type Address, getAddress, type Hex, isAddress, isHex, zeroAddress } from 'viem'
import type { PackageSignature, SafeTxPackage } from '@/schemas/package'
import { type ServiceConfirmation, ServiceTx } from '@/schemas/tx-service'
import { makePackage, SUPPORTED_PACKAGE_VERSIONS } from './package'
import type { SafeTx } from './safe-tx'
import { checkEip712SignatureBytes } from './signatures'

export const TX_SERVICE_ORIGIN = 'https://api.safe.global'

/**
 * Chains Safe runs a Transaction Service for: the EIP-3770 prefix Safe{Wallet} links use, and the
 * service's path on api.safe.global. From safe-config.safe.global/api/v1/chains on 2026-09-29.
 */
export const TX_SERVICE_CHAINS: Readonly<Record<number, { prefix: string; path: string }>> = {
  1: { prefix: 'eth', path: 'eth' },
  10: { prefix: 'oeth', path: 'oeth' },
  50: { prefix: 'xdc', path: 'xdc' },
  56: { prefix: 'bnb', path: 'bnb' },
  100: { prefix: 'gno', path: 'gno' },
  130: { prefix: 'unichain', path: 'unichain' },
  137: { prefix: 'matic', path: 'pol' },
  143: { prefix: 'monad', path: 'monad' },
  146: { prefix: 'sonic', path: 'sonic' },
  196: { prefix: 'xlayer', path: 'okb' },
  204: { prefix: 'opbnb', path: 'opbnb' },
  324: { prefix: 'zksync', path: 'zksync' },
  480: { prefix: 'wc', path: 'wc' },
  677: { prefix: 'bot', path: 'bot' },
  988: { prefix: 'stable', path: 'stable' },
  999: { prefix: 'hyper-evm', path: 'hyper' },
  1001: { prefix: 'kairos', path: 'kairos' },
  1672: { prefix: 'pharos', path: 'pharos' },
  1874: { prefix: 'wch-sepolia', path: 'wch-sepolia' },
  2818: { prefix: 'morph', path: 'morph' },
  3338: { prefix: 'peaq', path: 'peaq' },
  4217: { prefix: 'tempo', path: 'tempo' },
  4326: { prefix: 'megaeth', path: 'mega' },
  4663: { prefix: 'robinhood', path: 'robinhood' },
  5000: { prefix: 'mnt', path: 'mantle' },
  5003: { prefix: 'mnt-sep', path: 'mnt-sep' },
  5042: { prefix: 'arc', path: 'arc' },
  8217: { prefix: 'kaia', path: 'kaia' },
  8453: { prefix: 'base', path: 'base' },
  9745: { prefix: 'plasma', path: 'plasma' },
  10143: { prefix: 'monad-testnet', path: 'monad-testnet' },
  10200: { prefix: 'chiado', path: 'chi' },
  16661: { prefix: '0g', path: '0g' },
  25363: { prefix: 'fluent', path: 'fluent' },
  36900: { prefix: 'adi', path: 'adi' },
  42161: { prefix: 'arb1', path: 'arb1' },
  42220: { prefix: 'celo', path: 'celo' },
  42431: { prefix: 'tempo-moderato', path: 'tempo-moderato' },
  43111: { prefix: 'hemi', path: 'hemi' },
  43114: { prefix: 'avax', path: 'avax' },
  46630: { prefix: 'robinhood-testnet', path: 'robinhood-testnet' },
  57073: { prefix: 'ink', path: 'ink' },
  59144: { prefix: 'linea', path: 'linea' },
  80069: { prefix: 'bepolia', path: 'bep' },
  80094: { prefix: 'berachain', path: 'berachain' },
  84532: { prefix: 'basesep', path: 'basesep' },
  102030: { prefix: 'ctc', path: 'ctc' },
  534352: { prefix: 'scr', path: 'scr' },
  747474: { prefix: 'katana', path: 'katana' },
  936485: { prefix: 'zenith-testnet', path: 'zenith-testnet' },
  5042002: { prefix: 'arc-testnet', path: 'arc-testnet' },
  11142220: { prefix: 'celo-sep', path: 'celo-sep' },
  11155111: { prefix: 'sep', path: 'sep' },
  1313161554: { prefix: 'aurora', path: 'aurora' },
}

export const hasTxService = (chainId: number) => chainId in TX_SERVICE_CHAINS

/** At most this many pending transactions are read per pull. */
export const PULL_LIMIT = 50

function base(chainId: number): string {
  const c = TX_SERVICE_CHAINS[chainId]
  if (!c) throw new Error(`Safe runs no Transaction Service for chain ${chainId}.`)
  return `${TX_SERVICE_ORIGIN}/tx-service/${c.path}/api`
}

// Every URL ends in "/": the service redirects otherwise, and netguard refuses redirects.
export const txServiceUrls = {
  pending: (chainId: number, safe: Address, fromNonce: bigint) =>
    `${base(chainId)}/v2/safes/${getAddress(safe)}/multisig-transactions/?executed=false&nonce__gte=${fromNonce}&ordering=nonce&limit=${PULL_LIMIT}`,
  tx: (chainId: number, safeTxHash: Hex) =>
    `${base(chainId)}/v2/multisig-transactions/${safeTxHash.toLowerCase()}/`,
  safe: (chainId: number, safe: Address) => `${base(chainId)}/v1/safes/${getAddress(safe)}/`,
  propose: (chainId: number, safe: Address) =>
    `${base(chainId)}/v2/safes/${getAddress(safe)}/multisig-transactions/`,
  confirm: (chainId: number, safeTxHash: Hex) =>
    `${base(chainId)}/v1/multisig-transactions/${safeTxHash.toLowerCase()}/confirmations/`,
}

// ---------- service → package ----------

/**
 * A page's records, decoded one by one: one the schema rejects is counted in `malformed` instead
 * of hiding the rest of the page.
 */
export function decodeServiceRecords(results: readonly unknown[]): {
  records: ServiceTx[]
  malformed: number
} {
  const records: ServiceTx[] = []
  let malformed = 0
  for (const r of results) {
    const decoded = Schema.decodeUnknownEither(ServiceTx)(r)
    if (Either.isRight(decoded)) records.push(decoded.right)
    else malformed++
  }
  return { records, malformed }
}

export function serviceSafeTx(t: ServiceTx): SafeTx {
  return {
    to: getAddress(t.to),
    value: BigInt(t.value),
    data: (t.data ?? '0x').toLowerCase() as Hex,
    operation: t.operation,
    safeTxGas: BigInt(t.safeTxGas),
    baseGas: BigInt(t.baseGas),
    gasPrice: BigInt(t.gasPrice),
    gasToken: getAddress(t.gasToken ?? zeroAddress),
    refundReceiver: getAddress(t.refundReceiver ?? zeroAddress),
    nonce: BigInt(t.nonce),
  }
}

/**
 * Plain EOA signatures only. `APPROVED_HASH` confirmations are onchain `approveHash` calls, which
 * the app already reads from the chain (SPEC §5.2); `ETH_SIGN` and `CONTRACT_SIGNATURE` are out of
 * scope (§2). The claimed owner is checked by recovery in verifyPackage.
 */
export function serviceSignatures(confirmations: readonly ServiceConfirmation[]): {
  signatures: PackageSignature[]
  skipped: number
} {
  const signatures: PackageSignature[] = []
  let skipped = 0
  for (const c of confirmations) {
    if (c.signatureType === 'APPROVED_HASH') continue
    if (c.signatureType === 'EOA' && c.signature && !checkEip712SignatureBytes(c.signature)) {
      signatures.push({
        signer: getAddress(c.owner),
        kind: 'eip712',
        data: c.signature.toLowerCase() as Hex,
      })
    } else skipped++
  }
  return { signatures, skipped }
}

/** Safe{Wallet} stores the proposer's note inside `origin`, a JSON string. */
export function serviceNote(origin: string | null | undefined): string | undefined {
  if (!origin) return undefined
  try {
    const note = (JSON.parse(origin) as { note?: unknown })?.note
    return typeof note === 'string' && note.trim() ? note.trim().slice(0, 1000) : undefined
  } catch {
    return undefined
  }
}

/**
 * A package built from a service record. Its hashes are ours; the caller compares them with the
 * service's claimed safeTxHash and runs verifyPackage, which recovers every signature.
 */
export function packageFromService(
  chainId: number,
  safeVersion: string,
  t: ServiceTx,
): { pkg: SafeTxPackage; skipped: number } {
  const { signatures, skipped } = serviceSignatures(t.confirmations)
  const note = serviceNote(t.origin)
  const pkg = makePackage({
    chainId,
    safe: getAddress(t.safe),
    safeVersion,
    tx: serviceSafeTx(t),
    signatures,
    note,
  })
  return { pkg, skipped }
}

/**
 * The version a package rebuilt from the service claims. The service reports versions like
 * "1.3.0+L2" (the L2 edition hashes the same way), or none at all. Every supported version shares
 * the v1.3.0 EIP-712 domain, and the caller has already matched the safeTxHash, so a missing or
 * unknown claim falls back to "1.3.0". It's only a claim: the chain check reads the real version
 * from the singleton's code hash (SPEC §4.2).
 */
export function serviceVersion(v: string | null | undefined): string {
  const claimed = (v ?? '').replace(/\+L2$/i, '')
  return SUPPORTED_PACKAGE_VERSIONS.has(claimed) ? claimed : '1.3.0'
}

// ---------- Safe{Wallet} links ----------

export interface SafeWalletLink {
  readonly chainId: number
  readonly safe: Address
  readonly safeTxHash: Hex
}

const PREFIX_TO_CHAIN = new Map(
  Object.entries(TX_SERVICE_CHAINS).map(([id, c]) => [c.prefix, Number(id)]),
)

/**
 * A Safe{Wallet} transaction link, e.g.
 * `https://app.safe.global/transactions/tx?safe=eth:0x…&id=multisig_0x…_0x<safeTxHash>`.
 * Any host is accepted (self-hosted copies use the same paths); only the query is read.
 */
export function parseSafeWalletLink(text: string): SafeWalletLink | undefined {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return undefined
  }
  const safeParam = url.searchParams.get('safe')
  const id = url.searchParams.get('id')
  if (!safeParam || !id) return undefined
  const [prefix, address] = safeParam.split(':')
  const chainId = prefix ? PREFIX_TO_CHAIN.get(prefix) : undefined
  const m = /^multisig_(0x[0-9a-fA-F]{40})_(0x[0-9a-fA-F]{64})$/.exec(id)
  if (!chainId || !address || !isAddress(address, { strict: false }) || !m) return undefined
  if (m[1]?.toLowerCase() !== address.toLowerCase()) return undefined
  const safeTxHash = m[2] as Hex
  return isHex(safeTxHash) ? { chainId, safe: getAddress(address), safeTxHash } : undefined
}

// ---------- posting ----------

/** What the service already has for a transaction: nothing (404), or these confirmations. */
export type RemoteState =
  | { readonly exists: false }
  | { readonly exists: true; readonly signers: readonly Address[] }

export interface PostPlan {
  /** Propose the transaction with this signature (the service requires one from an owner). */
  readonly propose?: PackageSignature
  /** Then add these as confirmations. */
  readonly confirm: readonly PackageSignature[]
}

/**
 * Which of our owner signatures the service is missing. Non-owner signatures are never posted:
 * the service would refuse them, and they don't count anyway.
 */
export function planPost(
  signatures: readonly PackageSignature[],
  owners: readonly Address[],
  remote: RemoteState,
  preferredProposer?: Address,
): PostPlan {
  const ownerSet = new Set(owners.map((o) => o.toLowerCase()))
  const ours = signatures.filter((s) => ownerSet.has(s.signer.toLowerCase()))
  if (remote.exists) {
    const have = new Set(remote.signers.map((s) => s.toLowerCase()))
    return { confirm: ours.filter((s) => !have.has(s.signer.toLowerCase())) }
  }
  const propose =
    ours.find((s) => s.signer.toLowerCase() === preferredProposer?.toLowerCase()) ?? ours[0]
  if (!propose) return { confirm: [] }
  return { propose, confirm: ours.filter((s) => s !== propose) }
}

/** The body the service expects when proposing a transaction. */
export function proposeBody(pkg: SafeTxPackage, proposer: PackageSignature) {
  const t = pkg.tx
  return {
    safe: getAddress(pkg.safe),
    to: getAddress(t.to),
    value: t.value,
    data: t.data === '0x' ? null : t.data,
    operation: t.operation,
    safeTxGas: t.safeTxGas,
    baseGas: t.baseGas,
    gasPrice: t.gasPrice,
    gasToken: getAddress(t.gasToken),
    refundReceiver: getAddress(t.refundReceiver),
    nonce: t.nonce,
    contractTransactionHash: pkg.hashes.safeTx,
    sender: getAddress(proposer.signer),
    signature: proposer.data,
    origin: JSON.stringify({ url: 'https://plainsafe.eth', name: 'Plain Safe' }),
  }
}
