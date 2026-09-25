// Everything the review screen needs to judge a transaction (SPEC §3.4): the Safe at a pinned
// block, whatsabi facts about the target, the decoded call and the safety banners.
import { type UseQueryResult, useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { Address } from 'viem'
import { type Decoded, decodeBatch, decodeCalldata, type Guess, guessCall } from '@/core/decode'
import { findMultiSend } from '@/core/deployments'
import { knownAbis, safeManagementAbi } from '@/core/known-abis'
import { decodeMultiSend } from '@/core/multisend'
import type { SafeTx } from '@/core/safe-tx'
import { type Banner, safetyBanners, type TargetFacts } from '@/core/safety-rules'
import type { ContractInspection } from '@/features/abi/inspect'
import {
  inspectQuery,
  useInspect,
  useSavedAbi,
  useSignatureLookup,
  useSourcifyAbi,
} from '@/queries/contracts'
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

const combineInspections = (results: readonly UseQueryResult<ContractInspection>[]) => ({
  pending: results.some((r) => r.isPending),
  data: results.flatMap((r) => (r.data ? [r.data] : [])),
})

export function useTxAnalysis(chainId: number, safeAddress: Address, tx: SafeTx) {
  const safe = useSafe(chainId, safeAddress, true, true)
  const toSafe = tx.to.toLowerCase() === safeAddress.toLowerCase()
  const inspection = useInspect(chainId, tx.to)
  const saved = useSavedAbi(chainId, inspection.data?.implementationCodeHash)
  const sourcify = useSourcifyAbi(chainId, toSafe ? undefined : inspection.data)
  const sourcifyOn = useLoadedSettings().capabilities.sourcify
  // A batch's calls are known from the calldata alone; their targets are inspected in parallel.
  const batchTargets = useMemo(() => {
    if (tx.operation !== 1) return []
    const calls = decodeMultiSend(tx.data) ?? []
    return [...new Map(calls.map((c) => [c.to.toLowerCase(), c.to])).values()]
  }, [tx])
  const innerInspections = useQueries({
    queries: batchTargets.map((a) => inspectQuery(chainId, a)),
    combine: combineInspections,
  })
  const innerPending = innerInspections.pending
  const innerData = innerInspections.data

  const analysis = useMemo((): Analysis => {
    if (!safe.data || !inspection.data) return { pending: true }
    const i = inspection.data
    // With Sourcify on, wait for its answer (or its error) so the decoding doesn't change under
    // the reader.
    const sourcifyWanted =
      sourcifyOn && !toSafe && i.hasCode && !i.delegatedTo && !!i.implementationCodeHash
    if (sourcifyWanted && sourcify.status === 'pending') return { pending: true }
    // Calls on the Safe itself always use our own ABI (SPEC §7.2: owner changes use our decoding).
    const inner = new Map(innerData.map((x) => [x.address.toLowerCase(), x]))
    const multiSend = i.codeHash ? findMultiSend(i.codeHash) : undefined
    if (multiSend && tx.operation === 1 && innerPending) return { pending: true }
    const facts = (x: ContractInspection): TargetFacts => ({
      hasCode: x.hasCode,
      selectors: new Set(x.selectors.map((s) => s.toLowerCase())),
      isDelegatedEoa: !!x.delegatedTo,
    })
    const batch =
      multiSend && tx.operation === 1
        ? decodeBatch(tx.data, `${multiSend.contractName} v${multiSend.version}`, (c) => {
            const t = inner.get(c.to.toLowerCase())
            return c.to.toLowerCase() === safeAddress.toLowerCase()
              ? decodeCalldata(c.data, [{ source: 'Safe', abi: safeManagementAbi }])
              : decodeCalldata(
                  c.data,
                  knownAbis.map((k) => ({ source: `${k.name} standard ABI`, abi: k.abi })),
                  t?.hasCode && !t.delegatedTo
                    ? new Set(t.selectors.map((s) => s.toLowerCase()))
                    : undefined,
                )
          })
        : undefined
    const decoded = batch
      ? batch
      : toSafe
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
      targetIsVerifiedMultiSend: !!multiSend,
      innerTargets: new Map(
        [...inner].map(([k, x]) => [
          k,
          { ...facts(x), isVerifiedMultiSend: !!(x.codeHash && findMultiSend(x.codeHash)) },
        ]),
      ),
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
    innerPending,
    innerData,
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
