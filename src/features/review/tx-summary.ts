// One-line summaries for lists (queue, onchain history) with the same sources as the review
// screen (SPEC §7.1): clear signing first, then the decoding from chain facts. The offline
// decoding stands in while those load, and for good if they can't be read.
import { useMemo } from 'react'
import type { Address, Hex } from 'viem'
import type { Decoded } from '@/core/decode'
import { describeCall } from '@/core/describe'
import { decodeOffline } from '@/core/offline-decode'
import type { SafeTx } from '@/core/safe-tx'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { useClearSigning } from '@/queries/clear-signing'
import { useLoadedSettings } from '@/queries/settings'
import { useDecodedCall } from './analysis'

/** The review screen's decoding, or the offline one when the target can't be inspected. */
export function useCallDecoding(chainId: number, safe: Address, tx: SafeTx) {
  const call = useDecodedCall(chainId, safe, tx)
  const offline = useMemo(
    () => decodeOffline(chainId, safe, tx, (name) => `${name} standard ABI`),
    [chainId, safe, tx],
  )
  return {
    ...call,
    decoded: call.decoded ?? (call.inspection.isError ? offline : undefined),
    offline,
  }
}

export function useTxSummary(
  chainId: number,
  safe: Address,
  snapshot: SafeSnapshot | undefined,
  tx: SafeTx,
  safeTxHash: Hex,
): {
  readonly text: string
  readonly clearSigning: boolean
  /** The decoding behind the text, or the offline one standing in; undefined while pending. */
  readonly decoded: Decoded | undefined
} {
  const settings = useLoadedSettings()
  const currency = settings.chains.find((c) => c.id === chainId)?.nativeCurrency ?? {
    symbol: 'ETH',
    decimals: 18,
  }
  const clear = useClearSigning(chainId, snapshot, tx, safeTxHash)
  const { decoded, offline } = useCallDecoding(chainId, safe, tx)
  // Calls on the Safe itself always use our own decoding (SPEC §7.2)
  const toSafe = tx.to.toLowerCase() === safe.toLowerCase()
  const fromClear = toSafe ? undefined : clear.data?.summary
  // Until the target is inspected, the offline decoding shows only when it decodes the call:
  // a batch or an unknown contract would otherwise read as unverified for a moment.
  const best = decoded ?? (offline.kind === 'raw' ? undefined : offline)
  if (fromClear) return { text: fromClear, clearSigning: true, decoded: best }
  return {
    text: best ? describeCall(tx, best, safe, currency) : 'Decoding…',
    clearSigning: false,
    decoded: best,
  }
}
