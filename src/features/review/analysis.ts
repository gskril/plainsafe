// Everything the review screen needs to judge a transaction (SPEC §3.4): the Safe at a pinned
// block, whatsabi facts about the target, the decoded call and the safety banners.
import { useMemo } from 'react'
import type { Address } from 'viem'
import { type Decoded, decodeCalldata, type Guess, guessCall } from '@/core/decode'
import { findMultiSend } from '@/core/deployments'
import { knownAbis, safeManagementAbi } from '@/core/known-abis'
import type { SafeTx } from '@/core/safe-tx'
import { type Banner, safetyBanners } from '@/core/safety-rules'
import { useInspect, useSavedAbi, useSignatureLookup, useSourcifyAbi } from '@/queries/contracts'
import { useSafe } from '@/queries/safes'
import { useLoadedSettings } from '@/queries/settings'

export interface Analysis {
  readonly decoded?: Decoded
  /** Level 4, display only: never used for banners. */
  readonly guess?: Guess
  readonly banners?: readonly Banner[]
  /** Still reading chain facts; banners are incomplete until this is false. */
  readonly pending: boolean
}

export function useTxAnalysis(chainId: number, safeAddress: Address, tx: SafeTx) {
  const safe = useSafe(chainId, safeAddress, true, true)
  const toSafe = tx.to.toLowerCase() === safeAddress.toLowerCase()
  const inspection = useInspect(chainId, tx.to)
  const saved = useSavedAbi(chainId, inspection.data?.implementationCodeHash)
  const sourcify = useSourcifyAbi(chainId, toSafe ? undefined : inspection.data)
  const sourcifyOn = useLoadedSettings().capabilities.sourcify

  const analysis = useMemo((): Analysis => {
    if (!safe.data || !inspection.data) return { pending: true }
    const i = inspection.data
    // With Sourcify on, wait for its answer (or its error) so the decoding doesn't change under
    // the reader.
    const sourcifyWanted =
      sourcifyOn && !toSafe && i.hasCode && !i.delegatedTo && !!i.implementationCodeHash
    if (sourcifyWanted && sourcify.status === 'pending') return { pending: true }
    // Calls on the Safe itself always use our own ABI (SPEC §7.2: owner changes use our decoding).
    const decoded = toSafe
      ? decodeCalldata(tx.data, [{ source: 'Safe', abi: safeManagementAbi }])
      : decodeCalldata(
          tx.data,
          // SPEC §7.1 level 3: the bundled set, then your ABI library, then Sourcify
          [
            ...knownAbis.map((k) => ({ source: `${k.name} standard ABI`, abi: k.abi })),
            ...(saved.data ? [{ source: 'Your ABI library', abi: saved.data.abi }] : []),
            ...(sourcify.data
              ? [
                  {
                    source: `Sourcify verified ABI${sourcify.data.name ? ` (${sourcify.data.name})` : ''}`,
                    abi: sourcify.data.abi,
                  },
                ]
              : []),
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
  }, [
    safe.data,
    inspection.data,
    saved.data,
    sourcify.data,
    sourcify.status,
    sourcifyOn,
    tx,
    toSafe,
    safeAddress,
  ])

  const rawSelector = analysis.decoded?.kind === 'raw' ? analysis.decoded.selector : undefined
  const signatures = useSignatureLookup(rawSelector)
  const guess = useMemo(
    () => (signatures.data ? guessCall(tx.data, signatures.data) : undefined),
    [signatures.data, tx.data],
  )

  return {
    safe,
    inspection,
    analysis: guess ? { ...analysis, guess } : analysis,
    remoteErrors: [sourcify.error, signatures.error].filter((e): e is Error => !!e),
  }
}
