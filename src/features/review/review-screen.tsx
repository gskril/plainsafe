// The one review screen (SPEC §3.4), for drafts and stored packages alike.
import type { ReactNode } from 'react'
import type { Address } from 'viem'
import { AddressView } from '@/components/address'
import type { Decoded } from '@/core/decode'
import { type SafeTx, safeTxHashes } from '@/core/safe-tx'
import type { Banner } from '@/core/safety-rules'
import { AuthenticityBadge } from '@/features/safes/authenticity-badge'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { describeError } from '@/lib/errors'
import { useLoadedSettings } from '@/queries/settings'
import { useTxAnalysis } from './analysis'
import { Callout, SafetyBanners } from './banners'
import { WhatsabiChecks } from './checks'
import { DecodedView } from './decoded-view'
import { HashesPanel } from './hashes'
import { TxFields } from './tx-fields'

export interface ReviewContext {
  readonly safe?: SafeSnapshot | undefined
  readonly decoded?: Decoded | undefined
  readonly banners?: readonly Banner[] | undefined
  readonly pending: boolean
}

export function ReviewScreen(props: {
  chainId: number
  safeAddress: Address
  tx: SafeTx
  /** The builder's own description (SPEC §3.4 item 2). */
  description?: string | undefined
  /** A package note: always shown as unverified (SPEC §6). */
  note?: string | undefined
  /** The main button and anything else below the review. */
  actions: (ctx: ReviewContext) => ReactNode
  /** Extra sections, such as signature progress. */
  children?: ReactNode
}) {
  const { chainId, safeAddress, tx } = props
  const settings = useLoadedSettings()
  const chain = settings.chains.find((c) => c.id === chainId)
  const { safe, inspection, analysis } = useTxAnalysis(chainId, safeAddress, tx)
  const hashes = safeTxHashes(chainId, safeAddress, tx)
  const summary =
    props.description ??
    (analysis.decoded?.kind === 'abi'
      ? `Call ${analysis.decoded.functionName}`
      : analysis.decoded?.kind === 'empty'
        ? 'Value transfer'
        : 'Unverified contract call')

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
      {/* 1. Safe identity */}
      <section className="flex flex-col gap-1" data-testid="identity">
        <p className="text-sm text-muted-foreground">
          {chain?.name ?? `Chain ${chainId}`} · nonce {tx.nonce.toString()}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <AddressView chainId={chainId} address={safeAddress} />
          {safe.data && <AuthenticityBadge authenticity={safe.data.authenticity} />}
        </div>
        {safe.error && <p className="text-sm text-destructive">{describeError(safe.error)}</p>}
      </section>

      {/* 2. Summary */}
      <h1 className="text-xl font-semibold" data-testid="summary">
        {summary}
      </h1>
      {props.note && (
        <p className="rounded-lg border border-dashed p-3 text-sm">
          <span className="font-medium">Proposer's note (unverified): </span>
          {props.note}
        </p>
      )}

      {/* 4. Safety banners come first so they can't be missed */}
      {analysis.banners && <SafetyBanners banners={analysis.banners} />}
      {inspection.error && (
        <p className="text-sm text-destructive">{describeError(inspection.error)}</p>
      )}

      {/* 3. Details */}
      {analysis.decoded && (
        <DecodedView chainId={chainId} tx={tx} decoded={analysis.decoded} safe={safe.data} />
      )}
      <WhatsabiChecks tx={tx} inspection={inspection.data} />

      {/* 5. Simulation (SPEC §7.5 arrives in build step 12) */}
      <Callout severity="yellow" title="Not simulated">
        This build doesn't simulate transactions yet. Check the details and hashes carefully.
      </Callout>

      {/* 6. Hashes, always */}
      <HashesPanel hashes={hashes} />
      <TxFields chainId={chainId} tx={tx} />

      {/* 7. Signatures, then the main button */}
      {props.children}
      {props.actions({
        safe: safe.data,
        decoded: analysis.decoded,
        banners: analysis.banners,
        pending: analysis.pending,
      })}
    </div>
  )
}
