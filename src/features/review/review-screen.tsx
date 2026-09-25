// The one review screen (SPEC §3.4), for drafts and stored packages alike.
import type { ReactNode } from 'react'
import type { Address } from 'viem'
import { AddressView } from '@/components/address'
import type { Decoded } from '@/core/decode'
import { describeCall } from '@/core/describe'
import { type SafeTx, safeTxHashes } from '@/core/safe-tx'
import type { Banner } from '@/core/safety-rules'
import { AuthenticityBadge } from '@/features/safes/authenticity-badge'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { describeError } from '@/lib/errors'
import { useClearSigning } from '@/queries/clear-signing'
import { useLoadedSettings } from '@/queries/settings'
import { useSimulation } from '@/queries/simulation'
import { useTxAnalysis } from './analysis'
import { SafetyBanners } from './banners'
import { WhatsabiChecks } from './checks'
import { ClearSigningView } from './clear-signing-view'
import { DecodedView } from './decoded-view'
import { HashesPanel } from './hashes'
import { SimulationPanel, simulationFailed } from './simulation-panel'
import { TxFields } from './tx-fields'

export interface ReviewContext {
  readonly safe?: SafeSnapshot | undefined
  readonly decoded?: Decoded | undefined
  readonly banners?: readonly Banner[] | undefined
  readonly pending: boolean
  /** A simulation ran and predicts failure (SPEC §7.5): the button says "Sign anyway". */
  readonly simulationFailed: boolean
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
  const { safe, inspection, analysis, remoteErrors } = useTxAnalysis(chainId, safeAddress, tx)
  const hashes = safeTxHashes(chainId, safeAddress, tx)
  const clear = useClearSigning(chainId, safe.data, tx, hashes.safeTx)
  const simulation = useSimulation(chainId, safe.data, tx, hashes.safeTx)
  const currency = chain?.nativeCurrency ?? { symbol: 'ETH', decimals: 18 }
  // SPEC §7.1/§7.2: clear signing leads when it describes the call, except for calls on the Safe
  // itself (owner changes and the like), which always use our own decoding.
  const toSafe = tx.to.toLowerCase() === safeAddress.toLowerCase()
  const clearLeads = !toSafe && !!clear.data?.summary
  const summary =
    (clearLeads ? clear.data?.summary : undefined) ??
    props.description ??
    (analysis.decoded ? describeCall(tx, analysis.decoded, safeAddress, currency) : 'Checking…')
  const decodedView = analysis.decoded && (
    <DecodedView
      chainId={chainId}
      tx={tx}
      decoded={analysis.decoded}
      guess={analysis.guess}
      safe={safe.data}
    />
  )

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
      {/* 1. Safe identity */}
      <section className="flex flex-col gap-1" data-testid="identity">
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span>
            {chain?.name ?? `Chain ${chainId}`} · nonce {tx.nonce.toString()}
            {safe.data && ` · Safe read at block ${safe.data.block.toString()}`}
          </span>
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => void safe.refetch()}
            disabled={safe.isFetching}
          >
            {safe.isFetching ? 'refreshing…' : 'refresh'}
          </button>
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
      {remoteErrors.map((e) => (
        <p key={e.message} className="text-sm text-muted-foreground">
          {describeError(e)}
        </p>
      ))}

      {/* 3. Details: the first rendering that resolves (SPEC §7.1), the other folded away */}
      {clearLeads && clear.data ? (
        <>
          <ClearSigningView chainId={chainId} result={clear.data} />
          {decodedView && <Folded title="ABI decoding">{decodedView}</Folded>}
        </>
      ) : (
        <>
          {decodedView}
          {clear.data && (
            <Folded title="Clear-signing view">
              <ClearSigningView chainId={chainId} result={clear.data} />
            </Folded>
          )}
        </>
      )}
      {clear.error && (
        <p className="text-sm text-muted-foreground">
          Clear signing couldn't render this transaction ({describeError(clear.error)}), so the ABI
          decoding is shown instead.
        </p>
      )}
      <WhatsabiChecks tx={tx} inspection={inspection.data} />

      {/* 5. Simulation (SPEC §7.5) */}
      {safe.data && (
        <SimulationPanel
          chainId={chainId}
          query={simulation}
          verified={safe.data.authenticity.status === 'verified'}
        />
      )}

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
        simulationFailed: simulationFailed(simulation),
      })}
    </div>
  )
}

function Folded({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border px-4 py-2 text-sm">
      <summary className="cursor-pointer text-muted-foreground">{title}</summary>
      <div className="mt-3 mb-2">{children}</div>
    </details>
  )
}
