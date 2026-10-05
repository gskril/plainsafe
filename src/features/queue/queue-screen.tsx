// #/safe/:chainId/:address/queue and /history (SPEC §3.9): local packages, plus what the Safe
// Transaction Service has (§3.15), grouped by nonce and tagged with where each came from.
import { ExternalLink, Trash2 } from 'lucide-react'
import type { Address, Hex } from 'viem'
import { Link, useLocation } from 'wouter'
import { explorerUrl } from '@/chains'
import { NotFound } from '@/components/layout/not-found'
import { Button } from '@/components/ui/button'
import type { VerifiedPackage } from '@/core/package'
import { classifyQueue, isHistory, QUEUE_STATE_TEXT, type QueueState } from '@/core/queue'
import type { SafeTx } from '@/core/safe-tx'
import { OnchainHistory } from '@/features/history/onchain-history'
import { useTxSummary } from '@/features/review/tx-summary'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { useSafeParams } from '@/features/safes/use-safe-params'
import type { QueueSimOutcome } from '@/features/simulation/program'
import { SAFE_WALLET, TxServiceQueueStatus } from '@/features/tx-service/tx-service-ui'
import { describeError } from '@/lib/errors'
import { list } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useDeletePackage, usePackages, useSavePackage } from '@/queries/packages'
import { useSafe } from '@/queries/safes'
import { useChain } from '@/queries/settings'
import { useQueueSimulation } from '@/queries/simulation'
import { useTxServicePull } from '@/queries/tx-service'
import type { PackageSource, StoredPackage } from '@/schemas/stored-package'

const TONE: Record<QueueState, string> = {
  'needs-signatures': 'bg-muted',
  ready: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  future: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  conflict: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
  executed: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  'nonce-used': 'bg-muted text-muted-foreground',
}

export function QueueScreen({ history = false }: { history?: boolean }) {
  const target = useSafeParams()
  if (!target) return <NotFound />
  return <Queue chainId={target.chainId} safe={target.address} history={history} />
}

/** Which of the facts the queue is sorted by couldn't be read. */
const unreadFacts = (s: SafeSnapshot) =>
  [
    s.owners ? undefined : 'owners',
    s.threshold === undefined ? 'threshold' : undefined,
    s.nonce === undefined ? 'nonce' : undefined,
  ].filter((x) => x !== undefined)

/** A queue row: a stored package, or one on the Safe Transaction Service not saved here yet. */
interface Row {
  readonly verified: VerifiedPackage
  readonly execution?: StoredPackage['execution']
  readonly source?: PackageSource
  readonly saved: boolean
}

const SOURCE_LABEL: Record<PackageSource, string> = {
  created: 'Created here',
  imported: 'Imported',
  'tx-service': SAFE_WALLET,
}

/** Where a row came from, plus whether Safe{Wallet} has it too. */
function rowTags(row: Row, onService: ReadonlySet<string>): string[] {
  const tags = row.source ? [SOURCE_LABEL[row.source]] : []
  if (onService.has(row.verified.hashes.safeTx.toLowerCase()) && !tags.includes(SAFE_WALLET))
    tags.push(SAFE_WALLET)
  return tags
}

function Queue({ chainId, safe, history }: { chainId: number; safe: Address; history: boolean }) {
  const chain = useChain(chainId)
  const snapshot = useSafe(chainId, safe, { fresh: true })
  const packages = usePackages(chainId, safe)
  const service = useTxServicePull(snapshot.data)
  const remove = useDeletePackage(chainId, safe)
  // Opening a transaction that's only on the service saves it here first (SPEC §3.15)
  const saveFromService = useSavePackage('tx-service')
  const [, navigate] = useLocation()
  const base = `/safe/${chainId}/${safe}`
  const error = snapshot.error ?? packages.error ?? remove.error ?? saveFromService.error

  const stored = packages.data?.packages ?? []
  const storedHashes = new Set(stored.map((p) => p.verified.hashes.safeTx.toLowerCase()))
  const onService = new Set(service.data?.onService.map((h) => h.toLowerCase()))
  const rows: Row[] = [
    ...stored.map((p) => ({ ...p, saved: true })),
    ...(service.data?.unsaved ?? [])
      .filter((v) => !storedHashes.has(v.hashes.safeTx.toLowerCase()))
      .map((verified) => ({ verified, source: 'tx-service' as const, saved: false })),
  ]
  // The queue is sorted by the Safe's nonce, owners and threshold: without them it can't be
  const unread = snapshot.data && unreadFacts(snapshot.data)

  const items =
    snapshot.data?.nonce !== undefined &&
    snapshot.data.threshold !== undefined &&
    snapshot.data.owners &&
    packages.data
      ? classifyQueue(
          rows.map((p) => ({
            safeTxHash: p.verified.hashes.safeTx,
            nonce: p.verified.tx.nonce,
            signers: p.verified.signatures.map((s) => s.signer),
            execution: p.execution,
            p,
          })),
          {
            nonce: snapshot.data.nonce,
            threshold: snapshot.data.threshold,
            owners: snapshot.data.owners,
          },
        ).filter((q) => isHistory(q.state) === history)
      : undefined
  const shown = history ? items?.slice().reverse() : items
  // P1: the queue's consecutive nonces, simulated together
  const queueSim = useQueueSimulation(
    chainId,
    snapshot.data,
    history
      ? undefined
      : items?.map(({ item: { p } }) => ({
          tx: p.verified.tx,
          safeTxHash: p.verified.hashes.safeTx,
        })),
  )

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">{history ? 'History' : 'Queue'}</h1>
        <Link
          href={`${base}/${history ? 'queue' : 'history'}`}
          className="text-sm underline underline-offset-4"
        >
          {history ? 'Queue' : 'History'}
        </Link>
        <Link href={base} className="text-sm underline underline-offset-4">
          Safe
        </Link>
      </div>
      {/* Keyed by Safe: a "Check once" error belongs to the Safe it was run for */}
      {!history && <TxServiceQueueStatus key={`${chainId}:${safe}`} snapshot={snapshot.data} />}
      {history && <OnchainHistory chainId={chainId} safe={safe} snapshot={snapshot.data} />}
      {history && (
        <h2 className="font-medium" data-testid="local-history-title">
          Local history
          <span className="block text-sm font-normal text-muted-foreground">
            Transactions this browser saw executed, or whose nonce was used by something else.
          </span>
        </h2>
      )}
      {error ? (
        <p className="text-destructive">{describeError(error)}</p>
      ) : unread?.length ? (
        <p className="text-destructive" data-testid="queue-unreadable">
          Couldn't read this Safe's {list(unread)} at block {snapshot.data?.block.toString()}, so
          its transactions can't be sorted into queue and history. Check that this address is a Safe
          and that your {chain?.name ?? 'chain'} RPC answers.
        </p>
      ) : (
        !shown && <p className="text-muted-foreground">Loading…</p>
      )}
      {!history && queueSim.data && queueSim.data.size > 0 && snapshot.data && (
        <p className="text-sm text-muted-foreground" data-testid="queue-simulation">
          Simulated in nonce order at block {snapshot.data.block.toString()}, as if each were
          executed in turn.
        </p>
      )}
      {!history && queueSim.error && (
        <p className="text-sm text-muted-foreground">
          The queue wasn't simulated: {describeError(queueSim.error)}
        </p>
      )}
      {shown?.length === 0 && (
        <p className="text-muted-foreground">
          {history
            ? 'Nothing here yet.'
            : 'No pending transactions. Build one, or import a shared link.'}
        </p>
      )}
      <ul className="flex flex-col gap-2" data-testid={history ? 'history' : 'queue'}>
        {shown?.map(({ item, state, validSignatures }) => {
          const { p } = item
          const tx = p.verified.tx
          const execLink =
            p.execution && chain ? explorerUrl(chain, 'tx', p.execution.txHash) : undefined
          return (
            <li
              key={item.safeTxHash}
              className="flex items-start gap-3 rounded-lg border p-3"
              data-state={state}
            >
              <span className="w-10 shrink-0 font-mono text-sm leading-6 text-muted-foreground">
                #{tx.nonce.toString()}
              </span>
              {/* Stacked, so the summary gets the row's full width on a phone */}
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Link
                  href={`${base}/tx/${item.safeTxHash}`}
                  onClick={(e) => {
                    if (p.saved) return
                    // Only on the service: save it, then open it like any stored package
                    e.preventDefault()
                    void saveFromService
                      .mutateAsync(p.verified)
                      .then(() => navigate(`${base}/tx/${item.safeTxHash}`))
                  }}
                  className="leading-6 hover:underline"
                >
                  <RowSummary
                    chainId={chainId}
                    safe={safe}
                    snapshot={snapshot.data}
                    tx={tx}
                    safeTxHash={item.safeTxHash}
                  />
                </Link>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className={cn('rounded-full px-2 py-0.5 font-medium', TONE[state])}>
                    {QUEUE_STATE_TEXT[state]}
                  </span>
                  {!history && snapshot.data?.threshold !== undefined && (
                    <span>
                      {validSignatures} of {snapshot.data.threshold.toString()} signatures
                    </span>
                  )}
                  <SimBadge outcome={queueSim.data?.get(item.safeTxHash)} />
                  {execLink && (
                    <a
                      href={execLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline"
                    >
                      transaction <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-mono">{item.safeTxHash.slice(0, 12)}…</span>
                  {rowTags(p, onService).map((tag) => (
                    <span
                      key={tag}
                      className="rounded border px-1.5 leading-5"
                      data-testid="row-source"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              {p.saved && (history || state === 'conflict') && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="-my-1 shrink-0"
                  aria-label="Delete from this browser"
                  onClick={() => remove.mutate(item.safeTxHash)}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {items?.some((i) => i.state === 'conflict') && (
        <p className="text-sm text-orange-800 dark:text-orange-300">
          A conflict means two different transactions use the same nonce: only one can execute.
          Delete the one you don't want.
        </p>
      )}
      {packages.data && packages.data.invalid.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {packages.data.invalid.length} stored package(s) failed verification and were not used.
        </p>
      )}
    </div>
  )
}

/** The same summary as the review screen (SPEC §7.1): clear signing first, then our decoding. */
function RowSummary(props: {
  chainId: number
  safe: Address
  snapshot: SafeSnapshot | undefined
  tx: SafeTx
  safeTxHash: Hex
}) {
  const summary = useTxSummary(
    props.chainId,
    props.safe,
    props.snapshot,
    props.tx,
    props.safeTxHash,
  )
  return (
    <span
      className="line-clamp-2 break-words"
      title={summary.clearSigning ? 'Clear signing, not reviewed' : undefined}
    >
      {summary.text}
    </span>
  )
}

function SimBadge({ outcome }: { outcome: QueueSimOutcome | undefined }) {
  if (!outcome) return null
  const [text, tone, title] =
    outcome.status === 'ok'
      ? ['✓ simulates', 'text-emerald-700 dark:text-emerald-400', undefined]
      : outcome.status === 'fails'
        ? ['✗ would fail', 'text-destructive', outcome.reason]
        : [
            'after a failing nonce',
            'text-muted-foreground',
            `Nonce ${outcome.nonce} would fail first, so this one wasn't simulated.`,
          ]
  return (
    <span
      className={cn('text-xs', tone)}
      title={title}
      data-testid="row-sim"
      data-sim={outcome.status}
    >
      {text}
    </span>
  )
}
