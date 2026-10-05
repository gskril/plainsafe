// Queue states (SPEC §3.9), from local packages and chain state, onchain approvals included.
import type { Address, Hex } from 'viem'

export type QueueState =
  | 'needs-signatures'
  | 'ready'
  | 'future'
  | 'conflict'
  | 'executed'
  | 'failed'
  | 'nonce-used'

interface QueueItemInput {
  readonly safeTxHash: Hex
  readonly nonce: bigint
  readonly signers: readonly Address[]
  /** Owners who approved the safeTxHash onchain (approveHash, SPEC §5.2): they count too. */
  readonly approvedBy?: readonly Address[] | undefined
  readonly execution?: { readonly status: 'executed' | 'failed' } | undefined
}

interface QueueItem<T extends QueueItemInput> {
  readonly item: T
  readonly state: QueueState
  /** Current owners who signed or approved onchain, each counted once. */
  readonly validSignatures: number
}

export const QUEUE_STATE_TEXT: Record<QueueState, string> = {
  'needs-signatures': 'Needs signatures',
  ready: 'Ready to execute',
  future: 'Future nonce',
  conflict: 'Conflict',
  executed: 'Executed',
  failed: 'Executed (inner call failed)',
  'nonce-used': 'Nonce used (executed or replaced)',
}

/** History is the executed, failed and nonce-used entries; they stay until deleted. */
export const isHistory = (s: QueueState) => s === 'executed' || s === 'failed' || s === 'nonce-used'

export function classifyQueue<T extends QueueItemInput>(
  items: readonly T[],
  chain: {
    readonly nonce: bigint
    readonly threshold: bigint
    readonly owners: readonly Address[]
  },
): QueueItem<T>[] {
  const owners = new Set(chain.owners.map((o) => o.toLowerCase()))
  const byNonce = new Map<bigint, Set<string>>()
  for (const i of items) {
    if (i.execution) continue
    const set = byNonce.get(i.nonce) ?? new Set()
    set.add(i.safeTxHash.toLowerCase())
    byNonce.set(i.nonce, set)
  }
  return items
    .map((item) => {
      const counted = new Set(
        [...item.signers, ...(item.approvedBy ?? [])]
          .map((s) => s.toLowerCase())
          .filter((s) => owners.has(s)),
      )
      const validSignatures = counted.size
      const state = ((): QueueState => {
        if (item.execution) return item.execution.status === 'executed' ? 'executed' : 'failed'
        if (item.nonce < chain.nonce) return 'nonce-used'
        if ((byNonce.get(item.nonce)?.size ?? 0) > 1) return 'conflict'
        if (item.nonce > chain.nonce) return 'future'
        return BigInt(validSignatures) >= chain.threshold ? 'ready' : 'needs-signatures'
      })()
      return { item, state, validSignatures }
    })
    .sort((a, b) => (a.item.nonce === b.item.nonce ? 0 : a.item.nonce < b.item.nonce ? -1 : 1))
}
