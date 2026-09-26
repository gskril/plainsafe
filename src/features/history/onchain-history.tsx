// Onchain history on the History view (SPEC §11): turned on per Safe, scanned by a worker, and
// shown with its completeness, never as complete when it isn't. Grouped by day; each row opens
// in place to show what the execution did, who signed it and its hashes.
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  Check,
  ChevronDown,
  CircleX,
  Code,
  Globe,
  Layers,
  PowerOff,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Stamp,
  Users,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { type Address, formatUnits, getAddress, type Hex, maxUint256, zeroAddress } from 'viem'
import { Link } from 'wouter'
import { explorerUrl } from '@/chains'
import { AddressView, CopyButton } from '@/components/address'
import { TooltipButton } from '@/components/tooltip-button'
import { Button } from '@/components/ui/button'
import type { Decoded } from '@/core/decode'
import { isExecution, txFromCalldata, txFromL2Event } from '@/core/history'
import {
  buildFeed,
  type FeedItem,
  feedItemKey,
  groupByDay,
  type OwnerChange,
} from '@/core/history-feed'
import type { BatchCall } from '@/core/multisend'
import type { SafeTx } from '@/core/safe-tx'
import { signatureParts } from '@/core/signatures'
import { run } from '@/effect/run'
import { Callout } from '@/features/review/banners'
import { DecodedView } from '@/features/review/decoded-view'
import { TxFields } from '@/features/review/tx-fields'
import { useCallDecoding, useTxSummary } from '@/features/review/tx-summary'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { describeError } from '@/lib/errors'
import { shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useTokenMeta } from '@/queries/contracts'
import {
  invalidateHistory,
  useExecutedSigners,
  useExecutingTransaction,
  useStoredHistory,
} from '@/queries/history'
import { usePackages } from '@/queries/packages'
import { useLoadedSettings } from '@/queries/settings'
import { useTokenUniverse } from '@/queries/tokens'
import type { HistoryCheckpoint, HistoryEvent } from '@/schemas/history'
import { historyTarget } from './history-sync'
import { startHistory, stopHistory } from './manager'
import { getCheckpoint, historyFloor, resetHistory, turnOffHistory } from './store'

/** Rows shown at first, and added by each "Show earlier". */
const PAGE = 30

export function OnchainHistory({
  chainId,
  safe,
  snapshot,
}: {
  chainId: number
  safe: Address
  snapshot: SafeSnapshot | undefined
}) {
  const settings = useLoadedSettings()
  const queryClient = useQueryClient()
  const { checkpoint, events, state } = useStoredHistory(chainId, safe)
  const chain = settings.chains.find((c) => c.id === chainId)
  const cp = checkpoint.data ?? undefined
  const a = snapshot?.authenticity
  const [shown, setShown] = useState(PAGE)
  const tip = cp?.tip
  const feed = useMemo(
    () => buildFeed([...(events.data ?? []), ...(tip ?? [])]),
    [events.data, tip],
  )
  // For the L1 nonce guess: how many multisig executions came after each one
  const later = useMemo(() => {
    const m = new Map<string, number>()
    let n = 0
    for (const item of feed)
      if (item.kind === 'execution' && isExecution(item.event.name)) m.set(feedItemKey(item), n++)
    return m
  }, [feed])

  const start = (c: HistoryCheckpoint) => {
    const target = historyTarget(settings, c)
    if (target) startHistory(target)
  }
  // SPEC §11: opening the History view brings a finished history up to date
  const updated = useRef(false)
  useEffect(() => {
    if (updated.current || !cp?.enabled || state?.running) return
    updated.current = true
    start(cp)
  })

  const reset = async () => {
    if (!snapshot || a?.status !== 'verified') return
    stopHistory(chainId, safe)
    await run(resetHistory(chainId, safe, a.version, historyFloor(chainId, snapshot.singleton)))
    await invalidateHistory(queryClient, chainId, safe)
    const fresh = await run(getCheckpoint(chainId, safe))
    if (fresh) start(fresh)
  }
  const turnOff = async () => {
    stopHistory(chainId, safe)
    await run(turnOffHistory(chainId, safe))
    await invalidateHistory(queryClient, chainId, safe)
  }

  if (checkpoint.isPending) return null
  if (chain?.rpc._tag !== 'url') {
    return (
      <p className="text-sm text-muted-foreground">
        Onchain history needs an RPC URL for this chain; it can't read logs through your wallet.
      </p>
    )
  }
  if (!cp?.enabled) {
    return (
      <section
        className="flex flex-col gap-2 rounded-lg border p-4 text-sm"
        data-testid="history-off"
      >
        <h2 className="font-medium">Onchain history</h2>
        <p className="text-muted-foreground">
          Scan this Safe's events back to its creation over your RPC (
          <span className="font-mono text-xs">{new URL(chain.rpc.url).host}</span>). It runs in the
          background while Plain Safe is open, resumes where it stopped, and is stored only in this
          browser.
        </p>
        <Button
          className="self-start"
          disabled={a?.status !== 'verified'}
          onClick={() => void reset()}
        >
          Turn on onchain history
        </Button>
      </section>
    )
  }

  const progress = state?.progress
  const status = state?.running ? 'scanning' : (cp.status ?? 'scanning')
  const nonce = cp.onchainNonce !== undefined ? BigInt(cp.onchainNonce) : snapshot?.nonce
  // The worker's count is current as soon as a chunk commits; the list catches up a moment later
  const executions =
    progress?.executions ??
    feed.filter((i) => i.kind === 'execution' && isExecution(i.event.name)).length
  const of = nonce !== undefined ? ` of ${nonce}` : ''
  const groups = groupByDay(feed.slice(0, shown), (i) => dayKey(i.event.timestamp))

  return (
    <section className="flex flex-col gap-4" data-testid="onchain-history" data-status={status}>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <h2 className="mr-auto font-medium">Onchain history</h2>
          <TooltipButton
            variant="ghost"
            size="sm"
            disabled={state?.running}
            onClick={() => start(cp)}
            tip="Scan the blocks since the last scan for new transactions. This also runs whenever you open this page."
          >
            <RefreshCw /> Refresh
          </TooltipButton>
          <TooltipButton
            variant="ghost"
            size="sm"
            onClick={() => void reset()}
            tip="Delete this Safe's stored history and scan again from its creation. Use it if the history looks wrong, for example after changing RPC."
          >
            <RotateCcw /> Rebuild
          </TooltipButton>
          <TooltipButton
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => void turnOff()}
            tip="Stop scanning and delete this Safe's stored history from this browser. Nothing onchain changes."
          >
            <PowerOff /> Turn off
          </TooltipButton>
        </div>
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="history-progress"
        >
          {state?.elsewhere ? (
            'Another Plain Safe tab is scanning this Safe.'
          ) : status === 'scanning' ? (
            `Scanning back… block ${(progress?.scannedDownTo ?? (cp.scannedDownTo ? BigInt(cp.scannedDownTo) : undefined))?.toString() ?? '…'} · ${executions}${of} transactions found.`
          ) : status === 'complete' ? (
            <>
              <Check className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
              <span>
                Complete: every one of this Safe's {executions} executions is here, read from{' '}
                {new URL(chain.rpc.url).host}.
              </span>
            </>
          ) : (
            `${executions}${of} transactions found.`
          )}
        </p>
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {status === 'incomplete' && (
        <Callout severity="yellow" title="History incomplete">
          Your RPC doesn't keep logs back to this Safe's creation. Switch this chain's RPC to one
          with full log history. {cp.reason}
        </Callout>
      )}
      {status === 'unavailable' && (
        <Callout severity="yellow" title="History unavailable">
          {cp.reason ?? "Your RPC doesn't serve historical logs."}
        </Callout>
      )}
      <div className="flex flex-col gap-6" data-testid="history-events">
        {feed.length === 0 && <p className="text-sm text-muted-foreground">No events yet.</p>}
        {groups.map((g) => (
          <section
            key={`${g.day}:${feedItemKey(g.items[0] as FeedItem)}`}
            className="flex flex-col gap-2"
            data-testid="history-day"
          >
            <h3 className="flex justify-between gap-4 text-sm font-semibold text-muted-foreground">
              <span>{dayLabel(g.day)}</span>
              <span className="font-normal">{countLabel(g.items)}</span>
            </h3>
            <ol className="divide-y overflow-hidden rounded-xl border">
              {g.items.map((item) => (
                <FeedRow
                  key={feedItemKey(item)}
                  chainId={chainId}
                  safe={safe}
                  snapshot={snapshot}
                  item={item}
                  nonce={nonce}
                  later={later.get(feedItemKey(item)) ?? 0}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>
      {feed.length > shown && (
        <Button variant="outline" className="self-center" onClick={() => setShown((n) => n + PAGE)}>
          Show earlier
        </Button>
      )}
    </section>
  )
}

// ---------- dates ----------

/** The local calendar day of a block timestamp (seconds), as YYYY-MM-DD. */
function dayKey(timestamp: string | undefined): string | undefined {
  if (!timestamp) return undefined
  const d = new Date(Number(timestamp) * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabel(day: string | undefined): string {
  if (!day) return 'Date not read yet'
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  }).format(new Date(y, m - 1, d))
}

const timeLabel = (timestamp: string | undefined) =>
  timestamp
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
        new Date(Number(timestamp) * 1000),
      )
    : ''

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function countLabel(items: readonly FeedItem[]): string {
  const executions = items.filter((i) => i.kind === 'execution').length
  const received = items.filter((i) => i.kind === 'event' && i.event.name === 'SafeReceived').length
  const other = items.length - executions - received
  return [
    executions ? plural(executions, 'transaction') : '',
    received ? plural(received, 'transfer in', 'transfers in') : '',
    other ? plural(other, 'other event') : '',
  ]
    .filter(Boolean)
    .join(', ')
}

// ---------- rows ----------

const TONES = {
  neutral: 'bg-muted text-foreground',
  muted: 'bg-muted text-muted-foreground',
  in: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  owners: 'bg-orange-50 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  ens: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
} as const
type Tone = keyof typeof TONES

/** A row that opens in place; what's inside is rendered only while it's open. */
function RowShell(props: {
  icon: ReactNode
  tone: Tone
  title: ReactNode
  meta?: ReactNode
  time: string
  open: boolean
  onOpenChange: (open: boolean) => void
  testId?: string
  children: ReactNode
}) {
  return (
    <li data-testid={props.testId}>
      <details
        className="group"
        open={props.open}
        onToggle={(ev) => props.onOpenChange(ev.currentTarget.open)}
      >
        <summary className="grid cursor-pointer list-none grid-cols-[2rem_minmax(0,1fr)_auto_1rem] items-center gap-x-4 px-4 py-3.5 group-open:bg-muted/50 hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
          <span
            className={cn(
              'flex size-8 items-center justify-center rounded-full [&_svg]:size-4',
              TONES[props.tone],
            )}
          >
            {props.icon}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] break-words">{props.title}</span>
            {props.meta && <span className="text-sm text-muted-foreground">{props.meta}</span>}
          </span>
          <span className="text-sm text-muted-foreground">{props.time}</span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        {props.open && (
          <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 bg-muted/50 pt-1 pr-4 pb-4 pl-16 text-sm">
            {props.children}
          </dl>
        )}
      </details>
    </li>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

const Mono = ({ children, title }: { children: ReactNode; title?: string }) => (
  <span className="font-mono text-[13px]" title={title}>
    {children}
  </span>
)

function FeedRow(props: {
  chainId: number
  safe: Address
  snapshot: SafeSnapshot | undefined
  item: FeedItem
  nonce: bigint | undefined
  later: number
}) {
  const { item } = props
  if (item.kind === 'execution' && isExecution(item.event.name))
    return <ExecutionRow {...props} item={item} />
  if (item.kind === 'execution') return <ModuleRow {...props} item={item} />
  return <EventRow {...props} event={item.event} />
}

type Execution = Extract<FeedItem, { kind: 'execution' }>

/** A multisig execution, its details recovered in the order of SPEC §11. */
function ExecutionRow(props: {
  chainId: number
  safe: Address
  snapshot: SafeSnapshot | undefined
  item: Execution
  nonce: bigint | undefined
  later: number
}) {
  const { chainId, safe, item, nonce } = props
  const e = item.event
  const safeTxHash = String(e.args.txHash) as Hex
  const [open, setOpen] = useState(false)
  const packages = usePackages(chainId, safe)
  // 1. L2 Safes: SafeMultiSigTransaction, just before
  const fromL2 =
    item.detail?.name === 'SafeMultiSigTransaction' ? txFromL2Event(item.detail.args) : undefined
  // 3. A local package with the same safeTxHash
  const local = packages.data?.packages.find(
    (p) => p.verified.hashes.safeTx.toLowerCase() === safeTxHash.toLowerCase(),
  )
  // 2. L1 Safes: the transaction's execTransaction, the nonce checked by the hash. Also read when
  // the row is opened, for who sent it and the signatures it carried.
  const needed = !fromL2 && !local && nonce !== undefined
  const sent = useExecutingTransaction(chainId, e, needed || open)
  const fromL1 = useMemo(
    () =>
      sent.data && nonce !== undefined
        ? txFromCalldata({
            input: sent.data.input,
            to: sent.data.to,
            chainId,
            safe,
            safeTxHash,
            nonceGuess: nonce - 1n - BigInt(props.later),
          })
        : undefined,
    [sent.data, nonce, chainId, safe, safeTxHash, props.later],
  )
  const tx: SafeTx | undefined = fromL2?.tx ?? local?.verified.tx ?? fromL1?.tx
  const signatures = fromL2?.signatures ?? fromL1?.signatures
  const failed = e.name === 'ExecutionFailure'

  const common = (
    <>
      <Field label="safeTxHash">
        <span className="flex items-start gap-1">
          <Mono>
            <span className="break-all">{safeTxHash}</span>
          </Mono>
          <CopyButton value={safeTxHash} label="Copy safeTxHash" />
        </span>
      </Field>
      <Field label="Transaction">
        <TxLink chainId={chainId} event={e} />
      </Field>
    </>
  )

  if (!tx) {
    const loading = sent.isPending && needed
    return (
      <RowShell
        icon={<Code />}
        tone="muted"
        title={
          loading ? 'Loading details…' : 'Executed via another contract. Details need tracing.'
        }
        meta={failed ? <span className="text-destructive">inner call failed</span> : undefined}
        time={timeLabel(e.timestamp)}
        open={open}
        onOpenChange={setOpen}
        testId="history-execution"
      >
        {sent.error && (
          <Field label="Error">
            <span className="text-muted-foreground">{describeError(sent.error)}</span>
          </Field>
        )}
        {common}
      </RowShell>
    )
  }
  return (
    <KnownExecution
      {...props}
      tx={tx}
      signatures={signatures}
      sender={sent.data?.from}
      localHref={local ? `/safe/${chainId}/${safe}/tx/${local.verified.hashes.safeTx}` : undefined}
      failed={failed}
      open={open}
      onOpenChange={setOpen}
      common={common}
    />
  )
}

function KnownExecution(props: {
  chainId: number
  safe: Address
  snapshot: SafeSnapshot | undefined
  item: Execution
  tx: SafeTx
  signatures: Hex | undefined
  sender: Address | undefined
  localHref: string | undefined
  failed: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  common: ReactNode
}) {
  const { chainId, safe, item, tx, failed } = props
  const safeTxHash = String(item.event.args.txHash) as Hex
  const summary = useTxSummary(chainId, safe, props.snapshot, tx, safeTxHash)
  const decoded = summary.decoded
  const count = props.signatures ? signatureParts(props.signatures).length : undefined
  const signed =
    count === undefined
      ? undefined
      : item.threshold !== undefined
        ? `${count} of ${plural(item.threshold, 'signature')}`
        : plural(count, 'signature')
  const meta = [
    `#${tx.nonce}`,
    decoded?.kind === 'batch' ? `batch of ${decoded.calls.length}` : undefined,
    signed,
  ]
    .filter(Boolean)
    .join(' · ')
  const look = executionLook(safe, tx, decoded, item, failed)
  const others = item.effects.filter(
    (x) =>
      !OWNER_EVENTS.has(x.name) &&
      // A call to the Safe itself (a cancel) logs receiving its 0 ETH: not worth a line
      !(
        x.name === 'SafeReceived' &&
        String(x.args.value) === '0' &&
        getAddress(String(x.args.sender)) === getAddress(safe)
      ),
  )
  return (
    <RowShell
      icon={look.icon}
      tone={look.tone}
      title={
        <span
          data-testid="history-summary"
          title={summary.clearSigning ? 'Clear signing, not reviewed' : undefined}
        >
          {summary.text}
        </span>
      }
      meta={
        <>
          {meta}
          {failed && <span className="text-destructive"> · inner call failed</span>}
        </>
      }
      time={timeLabel(item.event.timestamp)}
      open={props.open}
      onOpenChange={props.onOpenChange}
      testId="history-execution"
    >
      <Field label={decoded?.kind === 'batch' ? 'Calls' : 'Call'}>
        <CallsView chainId={chainId} safe={safe} tx={tx} decoded={decoded} />
      </Field>
      {item.owners && (
        <Field label="Owners">
          <OwnersView change={item.owners} />
        </Field>
      )}
      {others.length > 0 && (
        <Field label="Also logged">
          <ul className="flex flex-col gap-1">
            {others.map((x) => (
              <li key={`${x.blockNumber}:${x.logIndex}`}>
                <EventText chainId={chainId} safe={safe} event={x} />
              </li>
            ))}
          </ul>
        </Field>
      )}
      <Field label="Signed by">
        <SignersView
          chainId={chainId}
          safeTxHash={safeTxHash}
          signatures={props.signatures}
          sender={props.sender}
          threshold={item.threshold}
        />
      </Field>
      {props.common}
      <Field label="">
        <div className="flex flex-col gap-2">
          {props.localHref && (
            <Link href={props.localHref} className="underline underline-offset-4">
              Open the saved transaction
            </Link>
          )}
          <HistoryDetails chainId={chainId} safe={safe} tx={tx} />
        </div>
      </Field>
    </RowShell>
  )
}

const OWNER_EVENTS = new Set(['AddedOwner', 'RemovedOwner', 'ChangedThreshold'])

function executionLook(
  safe: Address,
  tx: SafeTx,
  decoded: Decoded | undefined,
  item: Execution,
  failed: boolean,
): { icon: ReactNode; tone: Tone } {
  if (failed) return { icon: <CircleX />, tone: 'failed' }
  if (item.owners) return { icon: <Users />, tone: 'owners' }
  const toSafe = getAddress(tx.to) === getAddress(safe)
  if (toSafe && decoded?.kind === 'empty' && tx.value === 0n)
    return { icon: <Ban />, tone: 'muted' }
  if (toSafe) return { icon: <Settings2 />, tone: 'owners' }
  if (decoded?.kind === 'batch') return { icon: <Layers />, tone: 'neutral' }
  if (decoded?.kind === 'empty') return { icon: <ArrowUpRight />, tone: 'neutral' }
  if (decoded?.kind === 'abi' && decoded.source.startsWith('ENS'))
    return { icon: <Globe />, tone: 'ens' }
  if (decoded?.kind === 'abi' && decoded.source.startsWith('ERC-20'))
    return { icon: <ArrowUpRight />, tone: 'neutral' }
  return { icon: <Code />, tone: 'neutral' }
}

/** A module's execution: modules act without signatures (SPEC §11). */
function ModuleRow(props: { chainId: number; safe: Address; item: Execution }) {
  const { chainId, safe, item } = props
  const [open, setOpen] = useState(false)
  const failed = item.event.name === 'ExecutionFromModuleFailure'
  const module = getAddress(String(item.event.args.module))
  const d = item.detail?.args
  return (
    <RowShell
      icon={failed ? <CircleX /> : <Puzzle />}
      tone={failed ? 'failed' : item.owners ? 'owners' : 'neutral'}
      title={`Module ${shortAddress(module)} executed a call`}
      meta={
        failed ? (
          <span className="text-destructive">inner call failed</span>
        ) : (
          'no signatures needed'
        )
      }
      time={timeLabel(item.event.timestamp)}
      open={open}
      onOpenChange={setOpen}
    >
      <Field label="Module">
        <AddressView chainId={chainId} address={module} />
      </Field>
      {d && (
        <Field label="Call">
          <span className="flex flex-col gap-1">
            <span>
              {Number(d.operation) === 1 ? 'Delegatecall to ' : 'To '}
              <Mono title={String(d.to)}>{shortAddress(String(d.to))}</Mono>
              {String(d.value) !== '0' && ` with ${String(d.value)} wei`}
            </span>
            <Mono>
              <span className="break-all">{shortData(String(d.data) as Hex)}</span>
            </Mono>
          </span>
        </Field>
      )}
      {item.owners && (
        <Field label="Owners">
          <OwnersView change={item.owners} />
        </Field>
      )}
      {item.effects.filter((x) => !OWNER_EVENTS.has(x.name)).length > 0 && (
        <Field label="Also logged">
          <ul className="flex flex-col gap-1">
            {item.effects
              .filter((x) => !OWNER_EVENTS.has(x.name))
              .map((x) => (
                <li key={`${x.blockNumber}:${x.logIndex}`}>
                  <EventText chainId={chainId} safe={safe} event={x} />
                </li>
              ))}
          </ul>
        </Field>
      )}
      <Field label="Transaction">
        <TxLink chainId={chainId} event={item.event} />
      </Field>
    </RowShell>
  )
}

/** An event outside any execution: ETH received, the Safe's creation, an onchain approval… */
function EventRow(props: { chainId: number; safe: Address; event: HistoryEvent }) {
  const { chainId, safe, event: e } = props
  const [open, setOpen] = useState(false)
  const settings = useLoadedSettings()
  const currency = settings.chains.find((c) => c.id === chainId)?.nativeCurrency ?? {
    symbol: 'ETH',
    decimals: 18,
  }
  const time = timeLabel(e.timestamp)
  const shell = (p: { icon: ReactNode; tone: Tone; title: ReactNode; meta?: ReactNode }) => (
    <RowShell {...p} time={time} open={open} onOpenChange={setOpen} testId="history-event">
      {e.name === 'SafeReceived' && (
        <Field label="From">
          <AddressView chainId={chainId} address={String(e.args.sender)} />
        </Field>
      )}
      {e.name === 'SafeSetup' && (
        <>
          <Field label="Owners">
            <Chips owners={(e.args.owners as readonly string[]).map((o) => getAddress(o))} />
          </Field>
          <Field label="Threshold">{String(e.args.threshold)}</Field>
          {String(e.args.fallbackHandler) !== zeroAddress && (
            <Field label="Fallback handler">
              <AddressView chainId={chainId} address={String(e.args.fallbackHandler)} />
            </Field>
          )}
        </>
      )}
      {e.name !== 'SafeReceived' && e.name !== 'SafeSetup' && Object.keys(e.args).length > 0 && (
        <Field label="Logged">
          <span className="flex flex-col gap-1">
            {Object.entries(e.args)
              .filter(([k]) => k !== 'signatures' && k !== 'additionalInfo')
              .map(([k, v]) => (
                <span key={k}>
                  {k} <Mono>{Array.isArray(v) ? v.join(', ') : shortData(String(v) as Hex)}</Mono>
                </span>
              ))}
          </span>
        </Field>
      )}
      <Field label="Transaction">
        <TxLink chainId={chainId} event={e} />
      </Field>
    </RowShell>
  )
  if (e.name === 'SafeReceived')
    return shell({
      icon: <ArrowDownLeft />,
      tone: 'in',
      title: (
        <>
          Received{' '}
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
            {formatUnits(BigInt(String(e.args.value)), currency.decimals)} {currency.symbol}
          </span>
        </>
      ),
      meta: (
        <>
          from <Mono title={String(e.args.sender)}>{shortAddress(String(e.args.sender))}</Mono>
        </>
      ),
    })
  if (e.name === 'SafeSetup')
    return shell({
      icon: <ShieldCheck />,
      tone: 'neutral',
      title: `Safe created with ${plural((e.args.owners as readonly string[]).length, 'owner')} and threshold ${String(e.args.threshold)}`,
    })
  if (e.name === 'ApproveHash')
    return shell({
      icon: <Stamp />,
      tone: 'neutral',
      title: (
        <>
          <Mono title={String(e.args.owner)}>{shortAddress(String(e.args.owner))}</Mono> approved a
          transaction onchain
        </>
      ),
      meta: <Mono>{shortData(String(e.args.approvedHash) as Hex)}</Mono>,
    })
  return shell({
    icon: OWNER_EVENTS.has(e.name) ? <Users /> : <Settings2 />,
    tone: OWNER_EVENTS.has(e.name) ? 'owners' : 'neutral',
    title: <EventText chainId={chainId} safe={safe} event={e} />,
  })
}

// ---------- pieces of a row ----------

function TxLink({ chainId, event }: { chainId: number; event: HistoryEvent }) {
  const settings = useLoadedSettings()
  const chain = settings.chains.find((c) => c.id === chainId)
  const href = chain ? explorerUrl(chain, 'tx', event.transactionHash) : undefined
  const text = shortData(event.transactionHash)
  return (
    <span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
          <Mono>{text}</Mono>
        </a>
      ) : (
        <Mono>{text}</Mono>
      )}{' '}
      <span className="text-muted-foreground">
        · block {Number(event.blockNumber).toLocaleString()}
      </span>
    </span>
  )
}

/** `0x1234…abcd`, with the length for anything longer than a word. */
function shortData(data: Hex | string): string {
  if (!data.startsWith('0x') || data.length <= 20) return data
  const bytes = (data.length - 2) / 2
  return `${data.slice(0, 6)}…${data.slice(-4)}${bytes > 32 ? ` (${bytes} bytes)` : ''}`
}

/** One line per event the Safe logged, in words. */
function EventText({
  chainId,
  safe,
  event: e,
}: {
  chainId: number
  safe: Address
  event: HistoryEvent
}) {
  const settings = useLoadedSettings()
  const currency = settings.chains.find((c) => c.id === chainId)?.nativeCurrency ?? {
    symbol: 'ETH',
    decimals: 18,
  }
  const a = (k: string) => {
    const v = getAddress(String(e.args[k]))
    return (
      <Mono title={v}>
        {v === getAddress(safe) ? 'this Safe' : v === zeroAddress ? 'none' : shortAddress(v)}
      </Mono>
    )
  }
  switch (e.name) {
    case 'SafeReceived':
      return (
        <>
          Received {formatUnits(BigInt(String(e.args.value)), currency.decimals)} {currency.symbol}{' '}
          from {a('sender')}
        </>
      )
    case 'AddedOwner':
      return <>Owner added: {a('owner')}</>
    case 'RemovedOwner':
      return <>Owner removed: {a('owner')}</>
    case 'ChangedThreshold':
      return <>Threshold changed to {String(e.args.threshold)}</>
    case 'EnabledModule':
      return <>Module enabled: {a('module')}</>
    case 'DisabledModule':
      return <>Module disabled: {a('module')}</>
    case 'ChangedGuard':
      return <>Guard set to {a('guard')}</>
    case 'ChangedModuleGuard':
      return <>Module guard set to {a('moduleGuard')}</>
    case 'ChangedFallbackHandler':
      return <>Fallback handler set to {a('handler')}</>
    case 'ChangedMasterCopy':
      return <>Singleton changed to {a('singleton')}</>
    case 'ApproveHash':
      return (
        <>
          {a('owner')} approved <Mono>{shortData(String(e.args.approvedHash))}</Mono> onchain
        </>
      )
    case 'SignMsg':
      return (
        <>
          Message signed onchain: <Mono>{shortData(String(e.args.msgHash))}</Mono>
        </>
      )
    default:
      return (
        <>
          {e.name}
          {Object.keys(e.args).length > 0 &&
            `: ${Object.entries(e.args)
              .filter(([k]) => k !== 'data' && k !== 'signatures' && k !== 'additionalInfo')
              .map(([k, v]) => `${k} ${String(v).slice(0, 42)}`)
              .join(', ')}`}
        </>
      )
  }
}

function Chips({
  owners,
  added = [],
  removed = [],
}: {
  owners: readonly Address[]
  added?: readonly Address[]
  removed?: readonly Address[]
}) {
  const isIn = (list: readonly Address[], a: Address) =>
    list.some((x) => x.toLowerCase() === a.toLowerCase())
  const chip = 'rounded-full px-2.5 py-0.5 font-mono text-[13px]'
  return (
    <span className="flex flex-wrap gap-1.5">
      {removed.map((o) => (
        <span
          key={`-${o}`}
          title={o}
          className={cn(chip, 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300')}
        >
          − {shortAddress(o)}
        </span>
      ))}
      {added.map((o) => (
        <span
          key={`+${o}`}
          title={o}
          className={cn(
            chip,
            'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
          )}
        >
          + {shortAddress(o)}
        </span>
      ))}
      {owners
        .filter((o) => !isIn(added, o))
        .map((o) => (
          <span key={o} title={o} className={cn(chip, 'border text-muted-foreground')}>
            {shortAddress(o)}
          </span>
        ))}
    </span>
  )
}

function OwnersView({ change }: { change: OwnerChange }) {
  const { before, after, thresholdBefore: tb, thresholdAfter: ta } = change
  const owners =
    before && after
      ? `${before.length} → ${plural(after.length, 'owner')}`
      : [
          change.added.length ? `${change.added.length} added` : '',
          change.removed.length ? `${change.removed.length} removed` : '',
        ]
          .filter(Boolean)
          .join(', ')
  const threshold =
    tb !== undefined && ta !== undefined
      ? tb === ta
        ? `threshold stays ${ta}`
        : `threshold ${tb} → ${ta}`
      : ta !== undefined
        ? `threshold ${ta}`
        : ''
  return (
    <span className="flex flex-col gap-1.5">
      <span>{[owners, threshold].filter(Boolean).join(' · ')}</span>
      <Chips owners={after ?? []} added={change.added} removed={change.removed} />
    </span>
  )
}

function SignersView(props: {
  chainId: number
  safeTxHash: Hex
  signatures: Hex | undefined
  sender: Address | undefined
  threshold: number | undefined
}) {
  const signers = useExecutedSigners(props.safeTxHash, props.signatures)
  if (!props.signatures || !signers.data)
    return <span className="text-muted-foreground">Reading the transaction…</span>
  const sent = (a: Address | undefined) =>
    !!a && !!props.sender && a.toLowerCase() === props.sender.toLowerCase()
  const note = (s: (typeof signers.data)[number]) =>
    s.kind === 'approved'
      ? sent(s.signer)
        ? 'sent it'
        : props.sender
          ? 'approved onchain'
          : 'pre-approved'
      : s.kind === 'contract'
        ? 'contract signature'
        : s.kind === 'eth_sign'
          ? 'eth_sign'
          : sent(s.signer)
            ? 'signed, and sent it'
            : undefined
  return (
    <span className="flex flex-col gap-1">
      {signers.data.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: signatures keep their order in the bytes
        <span key={`${s.signer ?? 'unknown'}:${i}`} className="flex flex-wrap items-center gap-x-2">
          {s.signer ? (
            <AddressView chainId={props.chainId} address={s.signer} />
          ) : (
            <span className="text-muted-foreground">a signature that doesn't recover</span>
          )}
          {note(s) && <span className="text-muted-foreground">({note(s)})</span>}
        </span>
      ))}
      <span className="text-muted-foreground">
        {props.threshold !== undefined
          ? `${signers.data.length} of ${props.threshold} needed at the time`
          : plural(signers.data.length, 'signature')}
      </span>
    </span>
  )
}

/** Each call in plain words, amounts included where the token is known. */
function CallsView(props: {
  chainId: number
  safe: Address
  tx: SafeTx
  decoded: Decoded | undefined
}) {
  const { decoded } = props
  if (!decoded) return <span className="text-muted-foreground">Decoding…</span>
  if (decoded.kind === 'batch')
    return (
      <span className="flex flex-col gap-1">
        <ol className="flex flex-col gap-1">
          {decoded.calls.map(({ call, decoded: inner }, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: calls have no identity but their place
            <li key={i} className="flex gap-2">
              <span className="text-muted-foreground">{i + 1}</span>
              <CallLine chainId={props.chainId} safe={props.safe} call={call} decoded={inner} />
            </li>
          ))}
        </ol>
        <span className="text-muted-foreground">{decoded.source}, verified by code hash</span>
      </span>
    )
  return (
    <span className="flex flex-col gap-1">
      <CallLine chainId={props.chainId} safe={props.safe} call={props.tx} decoded={decoded} />
      {decoded.kind === 'abi' && (
        <span className="text-muted-foreground">
          on <Mono title={props.tx.to}>{target(props.tx.to, props.safe)}</Mono> · {decoded.source}
        </span>
      )}
      {decoded.kind === 'raw' && (
        <span className="text-muted-foreground">Unverified: raw calldata</span>
      )}
    </span>
  )
}

const target = (to: Address, safe: Address) =>
  getAddress(to) === getAddress(safe) ? 'this Safe' : shortAddress(to)

function CallLine(props: {
  chainId: number
  safe: Address
  call: BatchCall | SafeTx
  decoded: Decoded
}) {
  const { call, decoded, safe } = props
  const settings = useLoadedSettings()
  const currency = settings.chains.find((c) => c.id === props.chainId)?.nativeCurrency ?? {
    symbol: 'ETH',
    decimals: 18,
  }
  const erc20 =
    decoded.kind === 'abi' &&
    decoded.source.startsWith('ERC-20') &&
    ['transfer', 'approve', 'transferFrom'].includes(decoded.functionName)
  const universe = useTokenUniverse(props.chainId)
  const listed = erc20
    ? universe?.find((t) => t.address.toLowerCase() === call.to.toLowerCase())
    : undefined
  const meta = useTokenMeta(props.chainId, erc20 && universe && !listed ? call.to : undefined)
  const token = listed ?? meta.data
  const value = (v: unknown, type: string): ReactNode => {
    if (type === 'address' && typeof v === 'string')
      return <Mono title={v}>{target(v as Address, safe)}</Mono>
    if (typeof v === 'bigint') return v.toString()
    if (typeof v === 'string' && v.startsWith('0x')) return <Mono>{shortData(v)}</Mono>
    if (Array.isArray(v)) return `[${plural(v.length, 'item')}]`
    if (typeof v === 'object' && v !== null) return '{…}'
    return String(v)
  }
  if (decoded.kind === 'empty')
    return getAddress(call.to) === getAddress(safe) && call.value === 0n ? (
      <span>Nothing: an empty call to this Safe</span>
    ) : (
      <span>
        Send {formatUnits(call.value, currency.decimals)} {currency.symbol} to{' '}
        <Mono title={call.to}>{target(call.to, safe)}</Mono>
      </span>
    )
  if (decoded.kind === 'router')
    return <span>Universal Router: {plural(decoded.router.commands.length, 'command')}</span>
  if (decoded.kind === 'raw')
    return (
      <span>
        Unverified call to <Mono title={call.to}>{target(call.to, safe)}</Mono>
        {decoded.selector && (
          <>
            {' '}
            (selector <Mono>{decoded.selector}</Mono>)
          </>
        )}
      </span>
    )
  if (decoded.kind === 'batch') return <span>A nested batch of {decoded.calls.length} calls</span>
  if (erc20 && token) {
    const amount = decoded.args.find((x) => x.type === 'uint256')?.value as bigint | undefined
    const to = decoded.args.find(
      (x) => x.type === 'address' && x.name !== 'sender' && x.name !== 'from',
    )
    return (
      <span>
        {decoded.functionName}{' '}
        {amount === undefined
          ? '?'
          : amount === maxUint256
            ? 'unlimited'
            : formatUnits(amount, token.decimals)}{' '}
        {token.symbol} → {to ? value(to.value, 'address') : '?'}
      </span>
    )
  }
  return (
    <span>
      <Mono>{decoded.functionName}</Mono>
      {decoded.args.map((x) => (
        <span key={x.name}>
          {' · '}
          <span className="text-muted-foreground">{x.name}</span> {value(x.value, x.type)}
        </span>
      ))}
    </span>
  )
}

/** The full decoding and every raw field, read only once opened. */
function HistoryDetails(props: { chainId: number; safe: Address; tx: SafeTx }) {
  const [open, setOpen] = useState(false)
  return (
    <details onToggle={(ev) => setOpen(ev.currentTarget.open)} data-testid="history-details">
      <summary className="cursor-pointer underline underline-offset-4">
        Full decoding and raw fields
      </summary>
      {open && <HistoryDecoded {...props} />}
    </details>
  )
}

function HistoryDecoded({ chainId, safe, tx }: { chainId: number; safe: Address; tx: SafeTx }) {
  // The review screen's decoding: batches only on a MultiSend verified by code hash (SPEC §7.4)
  const { decoded, guess, inspection, remoteErrors } = useCallDecoding(chainId, safe, tx)
  if (!decoded) return <p className="my-3 text-sm text-muted-foreground">Decoding…</p>
  return (
    <div className="my-3 flex flex-col gap-3">
      {[inspection.error, ...remoteErrors].map(
        (err) =>
          err && (
            <p key={err.message} className="text-sm text-muted-foreground">
              {describeError(err)}
            </p>
          ),
      )}
      <DecodedView chainId={chainId} tx={tx} decoded={decoded} guess={guess} />
      <TxFields chainId={chainId} tx={tx} />
    </div>
  )
}
