// Onchain history on the History view (SPEC §11): turned on per Safe, scanned by a worker, and
// shown with its completeness, never as complete when it isn't.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, PowerOff, RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type Address, formatUnits, getAddress, type Hex } from 'viem'
import { Link } from 'wouter'
import { explorerUrl } from '@/chains'
import { AddressView } from '@/components/address'
import { TooltipButton } from '@/components/tooltip-button'
import { Button } from '@/components/ui/button'
import { decodeBatch } from '@/core/decode'
import { findMultiSend } from '@/core/deployments'
import { describeCall } from '@/core/describe'
import { isExecution, txFromCalldata, txFromL2Event } from '@/core/history'
import { decodeOffline } from '@/core/offline-decode'
import type { SafeTx } from '@/core/safe-tx'
import { run } from '@/effect/run'
import { Callout } from '@/features/review/banners'
import { DecodedView } from '@/features/review/decoded-view'
import { TxFields } from '@/features/review/tx-fields'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { describeError } from '@/lib/errors'
import { useInspect } from '@/queries/contracts'
import { invalidateHistory, useStoredHistory } from '@/queries/history'
import { usePackages } from '@/queries/packages'
import { useLoadedSettings } from '@/queries/settings'
import type { HistoryCheckpoint, HistoryEvent } from '@/schemas/history'
import { historyTarget } from './history-sync'
import { startHistory, stopHistory } from './manager'
import { executingTransaction } from './recover'
import { getCheckpoint, historyFloor, resetHistory, turnOffHistory } from './store'

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
  const all = [...(events.data ?? []), ...cp.tip].sort((x, y) =>
    BigInt(y.blockNumber) === BigInt(x.blockNumber)
      ? y.logIndex - x.logIndex
      : BigInt(y.blockNumber) > BigInt(x.blockNumber)
        ? 1
        : -1,
  )
  const status = state?.running ? 'scanning' : (cp.status ?? 'scanning')
  const nonce = cp.onchainNonce !== undefined ? BigInt(cp.onchainNonce) : snapshot?.nonce
  // The worker's count is current as soon as a chunk commits; the list catches up a moment later
  const executions = progress?.executions ?? all.filter((e) => isExecution(e.name)).length

  return (
    <section className="flex flex-col gap-3" data-testid="onchain-history" data-status={status}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-medium">Onchain history</h2>
        <TooltipButton
          variant="outline"
          size="sm"
          disabled={state?.running}
          onClick={() => start(cp)}
          tip="Scan the blocks since the last scan for new transactions. This also runs whenever you open this page."
        >
          <RefreshCw /> Refresh
        </TooltipButton>
        <TooltipButton
          variant="outline"
          size="sm"
          onClick={() => void reset()}
          tip="Delete this Safe's stored history and scan again from its creation. Use it if the history looks wrong, for example after changing RPC."
        >
          <RotateCcw /> Rebuild history
        </TooltipButton>
        <TooltipButton
          variant="destructive"
          size="sm"
          onClick={() => void turnOff()}
          tip="Stop scanning and delete this Safe's stored history from this browser. Nothing onchain changes."
        >
          <PowerOff /> Turn off
        </TooltipButton>
      </div>
      <p className="text-sm text-muted-foreground" data-testid="history-progress">
        {state?.elsewhere
          ? 'Another Plain Safe tab is scanning this Safe.'
          : status === 'scanning'
            ? `Scanning back… block ${(progress?.scannedDownTo ?? (cp.scannedDownTo ? BigInt(cp.scannedDownTo) : undefined))?.toString() ?? '…'} · ${executions}${nonce !== undefined ? ` of ${nonce}` : ''} transactions found.`
            : `${executions}${nonce !== undefined ? ` of ${nonce}` : ''} transactions found.`}
      </p>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {status === 'complete' && (
        <Callout severity="info" title="History complete">
          Every execution since this Safe was created is here.
        </Callout>
      )}
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
      <ol className="flex flex-col divide-y rounded-lg border" data-testid="history-events">
        {all.length === 0 && <li className="p-3 text-sm text-muted-foreground">No events yet.</li>}
        {all.map((e) => (
          <EventRow
            key={`${e.blockNumber}:${e.logIndex}`}
            chainId={chainId}
            safe={safe}
            event={e}
            all={all}
            nonce={nonce}
          />
        ))}
      </ol>
    </section>
  )
}

function EventRow(props: {
  chainId: number
  safe: Address
  event: HistoryEvent
  all: readonly HistoryEvent[]
  nonce: bigint | undefined
}) {
  const { chainId, event: e } = props
  const settings = useLoadedSettings()
  const chain = settings.chains.find((c) => c.id === chainId)
  const currency = chain?.nativeCurrency ?? { symbol: 'ETH', decimals: 18 }
  const link = chain ? explorerUrl(chain, 'tx', e.transactionHash) : undefined
  const addr = (k: string) => getAddress(String(e.args[k]))
  const body = isExecution(e.name) ? (
    <ExecutionRow {...props} />
  ) : e.name === 'SafeReceived' ? (
    <span className="flex flex-wrap items-center gap-1">
      Received {formatUnits(BigInt(String(e.args.value)), currency.decimals)} {currency.symbol} from{' '}
      <AddressView chainId={chainId} address={addr('sender')} />
    </span>
  ) : e.name === 'AddedOwner' || e.name === 'RemovedOwner' ? (
    <span className="flex flex-wrap items-center gap-1">
      {e.name === 'AddedOwner' ? 'Owner added:' : 'Owner removed:'}{' '}
      <AddressView chainId={chainId} address={addr('owner')} />
    </span>
  ) : e.name === 'ChangedThreshold' ? (
    <span>Threshold changed to {String(e.args.threshold)}</span>
  ) : e.name === 'SafeSetup' ? (
    <span>
      Safe created with {(e.args.owners as readonly string[]).length} owners and threshold{' '}
      {String(e.args.threshold)}
    </span>
  ) : e.name === 'ApproveHash' ? (
    <span className="flex flex-wrap items-center gap-1">
      <AddressView chainId={chainId} address={addr('owner')} /> approved{' '}
      <span className="font-mono text-xs">{String(e.args.approvedHash).slice(0, 18)}…</span> onchain
    </span>
  ) : (
    <span>
      {e.name}
      {Object.keys(e.args).length > 0 &&
        `: ${Object.entries(e.args)
          .filter(([k]) => k !== 'data' && k !== 'signatures' && k !== 'additionalInfo')
          .map(([k, v]) => `${k} ${String(v).slice(0, 42)}`)
          .join(', ')}`}
    </span>
  )
  if (e.name === 'SafeMultiSigTransaction') return null
  return (
    <li className="flex flex-col gap-1 p-3 text-sm" data-event={e.name}>
      {body}
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        block {e.blockNumber}
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            transaction <ExternalLink className="size-3" />
          </a>
        )}
      </span>
    </li>
  )
}

/** An execution's details, recovered in the order of SPEC §11. */
function ExecutionRow(props: {
  chainId: number
  safe: Address
  event: HistoryEvent
  all: readonly HistoryEvent[]
  nonce: bigint | undefined
}) {
  const { chainId, safe, event: e } = props
  const settings = useLoadedSettings()
  const currency = settings.chains.find((c) => c.id === chainId)?.nativeCurrency ?? {
    symbol: 'ETH',
    decimals: 18,
  }
  const safeTxHash = String(e.args.txHash) as Hex
  const packages = usePackages(chainId, safe)
  // 1. L2 Safes: SafeMultiSigTransaction in the same transaction, just before
  const l2 = props.all.find(
    (x) =>
      x.name === 'SafeMultiSigTransaction' &&
      x.transactionHash === e.transactionHash &&
      x.logIndex < e.logIndex,
  )
  const fromL2 = l2 ? txFromL2Event(l2.args)?.tx : undefined
  // 3. A local package with the same safeTxHash
  const local = packages.data?.packages.find(
    (p) => p.verified.hashes.safeTx.toLowerCase() === safeTxHash.toLowerCase(),
  )
  // 2. L1 Safes: decode the transaction's execTransaction, the nonce checked by the hash
  const later = props.all.filter(
    (x) =>
      isExecution(x.name) &&
      (BigInt(x.blockNumber) > BigInt(e.blockNumber) ||
        (x.blockNumber === e.blockNumber && x.logIndex > e.logIndex)),
  ).length
  const l1 = useQuery({
    queryKey: ['history-tx', chainId, e.transactionHash, safeTxHash],
    queryFn: async () => {
      const t = await run(
        executingTransaction(chainId, e.transactionHash, BigInt(e.blockNumber), e.transactionIndex),
      )
      return (
        txFromCalldata({
          input: t.input,
          to: t.to,
          chainId,
          safe,
          safeTxHash,
          nonceGuess: (props.nonce ?? 0n) - 1n - BigInt(later),
        }) ?? null
      )
    },
    enabled: !fromL2 && !local && props.nonce !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const tx: SafeTx | undefined = fromL2 ?? local?.verified.tx ?? l1.data ?? undefined
  const summary = tx
    ? describeCall(tx, decodeOffline(chainId, safe, tx), safe, currency)
    : undefined
  const failed = e.name === 'ExecutionFailure'
  return (
    <div className="flex flex-col gap-1" data-testid="history-execution">
      <span className="flex flex-wrap items-center gap-2">
        {tx && <span className="font-mono text-muted-foreground">#{tx.nonce.toString()}</span>}
        <span className={failed ? 'text-destructive' : ''}>
          {summary ??
            (l1.isPending && !fromL2 && !local
              ? 'Loading details…'
              : 'Executed via another contract. Details need tracing.')}
        </span>
        <span
          className={
            failed ? 'text-xs text-destructive' : 'text-xs text-emerald-700 dark:text-emerald-400'
          }
        >
          {failed ? 'inner call failed' : 'executed'}
        </span>
        {local && (
          <Link
            href={`/safe/${chainId}/${safe}/tx/${local.verified.hashes.safeTx}`}
            className="text-xs underline"
          >
            open
          </Link>
        )}
      </span>
      <span className="font-mono text-xs break-all text-muted-foreground">
        safeTxHash {safeTxHash}
      </span>
      {l1.error && <span className="text-xs text-muted-foreground">{describeError(l1.error)}</span>}
      {tx && <HistoryDetails chainId={chainId} safe={safe} tx={tx} />}
    </div>
  )
}

/** The decoded call and every raw field, read only once the row is opened. */
function HistoryDetails(props: { chainId: number; safe: Address; tx: SafeTx }) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className="group rounded-lg border px-4 py-2"
      onToggle={(ev) => setOpen(ev.currentTarget.open)}
      data-testid="history-details"
    >
      <summary className="cursor-pointer text-sm font-medium">Decoded call and raw fields</summary>
      {open && <HistoryDecoded {...props} />}
    </details>
  )
}

function HistoryDecoded({ chainId, safe, tx }: { chainId: number; safe: Address; tx: SafeTx }) {
  // A batch is decoded call by call only when its target is a MultiSend by code hash (SPEC §7.4)
  const inspection = useInspect(chainId, tx.operation === 1 ? tx.to : undefined)
  const decoded = useMemo(() => {
    const multiSend =
      tx.operation === 1 && inspection.data?.codeHash
        ? findMultiSend(inspection.data.codeHash)
        : undefined
    const batch = multiSend
      ? decodeBatch(tx.data, `${multiSend.contractName} v${multiSend.version}`, (c) =>
          decodeOffline(chainId, safe, c, (name) => `${name} standard ABI`),
        )
      : undefined
    return batch ?? decodeOffline(chainId, safe, tx, (name) => `${name} standard ABI`)
  }, [chainId, safe, tx, inspection.data])
  if (tx.operation === 1 && inspection.isPending)
    return <p className="my-3 text-sm text-muted-foreground">Checking the batch contract…</p>
  return (
    <div className="my-3 flex flex-col gap-3">
      <DecodedView chainId={chainId} tx={tx} decoded={decoded} />
      <TxFields chainId={chainId} tx={tx} />
    </div>
  )
}
