// Everything the review screen needs to judge a transaction (SPEC §3.4): the Safe at a pinned
// block, whatsabi facts about the target, the decoded call and the safety banners.
import { useMemo } from 'react'
import type { Address } from 'viem'
import { type Decoded, decodeCalldata } from '@/core/decode'
import { findMultiSend } from '@/core/deployments'
import { knownAbis, safeManagementAbi } from '@/core/known-abis'
import type { SafeTx } from '@/core/safe-tx'
import { type Banner, safetyBanners } from '@/core/safety-rules'
import { useInspect, useSavedAbi } from '@/queries/contracts'
import { useSafe } from '@/queries/safes'

export interface Analysis {
  readonly decoded?: Decoded
  readonly banners?: readonly Banner[]
  /** Still reading chain facts; banners are incomplete until this is false. */
  readonly pending: boolean
}

export function useTxAnalysis(chainId: number, safeAddress: Address, tx: SafeTx) {
  const safe = useSafe(chainId, safeAddress)
  const toSafe = tx.to.toLowerCase() === safeAddress.toLowerCase()
  const inspection = useInspect(chainId, tx.to)
  const saved = useSavedAbi(chainId, inspection.data?.implementationCodeHash)

  const analysis = useMemo((): Analysis => {
    if (!safe.data || !inspection.data) return { pending: true }
    const i = inspection.data
    // Calls on the Safe itself always use our own ABI (SPEC §7.2: owner changes use our decoding).
    const decoded = toSafe
      ? decodeCalldata(tx.data, [{ source: 'Safe', abi: safeManagementAbi }])
      : decodeCalldata(
          tx.data,
          [
            ...(saved.data ? [{ source: 'Your ABI library', abi: saved.data.abi }] : []),
            ...knownAbis.map((k) => ({ source: `${k.name} standard ABI`, abi: k.abi })),
          ],
          i.hasCode && !i.delegatedTo
            ? new Set(i.selectors.map((s) => s.toLowerCase()))
            : undefined,
        )
    const banners = safetyBanners({
      safe: safeAddress,
      tx,
      decoded,
      safeVerified: safe.data.authenticity.status === 'verified',
      ...(safe.data.nonce !== undefined ? { onchainNonce: safe.data.nonce } : {}),
      targetIsVerifiedMultiSend: !!(i.codeHash && findMultiSend(i.codeHash)),
      target: {
        hasCode: i.hasCode,
        selectors: new Set(i.selectors.map((s) => s.toLowerCase())),
        isDelegatedEoa: !!i.delegatedTo,
      },
    })
    return { decoded, banners, pending: false }
  }, [safe.data, inspection.data, saved.data, tx, toSafe, safeAddress])

  return { safe, inspection, analysis }
}
