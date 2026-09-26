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
import { decodeRouterFor } from '@/core/uniswap'
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

/**
 * The call decoded at the best level the chain facts allow (SPEC §7.1 levels 3–5): a MultiSend
 * batch verified by code hash, this chain's Universal Router, the Safe's own ABI for calls on
 * itself, then the bundled set, your ABI library and Sourcify, each function only if its selector
 * is in the target's bytecode (§7.3). Level 4 guesses come separately and are display only.
 */
export function useDecodedCall(chainId: number, safeAddress: Address, tx: SafeTx) {
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

  const decoded = useMemo((): Decoded | undefined => {
    if (!inspection.data) return undefined
    const i = inspection.data
    // With Sourcify on, wait for its answer (or its error) so the decoding doesn't change under
    // the reader.
    const sourcifyWanted =
      sourcifyOn && !toSafe && i.hasCode && !i.delegatedTo && !!i.implementationCodeHash
    if (sourcifyWanted && sourcify.status === 'pending') return undefined
    // Calls on the Safe itself always use our own ABI (SPEC §7.2: owner changes use our decoding).
    const inner = new Map(innerData.map((x) => [x.address.toLowerCase(), x]))
    const multiSend = i.codeHash ? findMultiSend(i.codeHash) : undefined
    if (multiSend && tx.operation === 1 && innerPending) return undefined
    const batch =
      multiSend && tx.operation === 1
        ? decodeBatch(tx.data, `${multiSend.contractName} v${multiSend.version}`, (c) => {
            const t = inner.get(c.to.toLowerCase())
            const router = c.operation === 0 ? decodeRouterFor(chainId, c.to, c.data) : undefined
            if (router) return router
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
    if (batch) return batch
    // This chain's Universal Router: our own command-by-command decoding (SPEC §3.13)
    const router = tx.operation === 0 ? decodeRouterFor(chainId, tx.to, tx.data) : undefined
    if (router) return router
    if (toSafe) return decodeCalldata(tx.data, [{ source: 'Safe', abi: safeManagementAbi }])
    return decodeCalldata(
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
      i.hasCode && !i.delegatedTo ? new Set(i.selectors.map((s) => s.toLowerCase())) : undefined,
    )
  }, [
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
    chainId,
  ])

  const rawSelector = decoded?.kind === 'raw' ? decoded.selector : undefined
  const signatures = useSignatureLookup(rawSelector)
  const guess = useMemo(
    () => (signatures.data ? guessCall(tx.data, signatures.data) : undefined),
    [signatures.data, tx.data],
  )

  return {
    inspection,
    /** whatsabi facts about each batch call's target. */
    innerInspections: innerData,
    decoded,
    guess,
    remoteErrors: [sourcify.error, signatures.error].filter((e): e is Error => !!e),
  }
}

export function useTxAnalysis(chainId: number, safeAddress: Address, tx: SafeTx) {
  const safe = useSafe(chainId, safeAddress, true, true)
  const call = useDecodedCall(chainId, safeAddress, tx)
  const { inspection, innerInspections, decoded, guess } = call

  const analysis = useMemo((): Analysis => {
    if (!safe.data || !inspection.data || !decoded) return { pending: true }
    const i = inspection.data
    const inner = new Map(innerInspections.map((x) => [x.address.toLowerCase(), x]))
    const facts = (x: ContractInspection): TargetFacts => ({
      hasCode: x.hasCode,
      selectors: new Set(x.selectors.map((s) => s.toLowerCase())),
      isDelegatedEoa: !!x.delegatedTo,
    })
    const banners = safetyBanners({
      safe: safeAddress,
      tx,
      decoded,
      safeVerified: safe.data.authenticity.status === 'verified',
      ...(safe.data.nonce !== undefined ? { onchainNonce: safe.data.nonce } : {}),
      targetIsVerifiedMultiSend: !!(i.codeHash && findMultiSend(i.codeHash)),
      innerTargets: new Map(
        [...inner].map(([k, x]) => [
          k,
          { ...facts(x), isVerifiedMultiSend: !!(x.codeHash && findMultiSend(x.codeHash)) },
        ]),
      ),
      target: facts(i),
    })
    return { decoded, banners, pending: false }
  }, [safe.data, inspection.data, innerInspections, decoded, tx, safeAddress])

  return {
    safe,
    inspection,
    analysis: guess ? { ...analysis, guess } : analysis,
    remoteErrors: call.remoteErrors,
  }
}
