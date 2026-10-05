// Safe Transaction Service in the UI (SPEC §3.15): a status line on the queue, and posting from the
// review screen. Off by default; each place says which host it would contact before it does.

import { RefreshCw } from 'lucide-react'
import { useConnection } from 'wagmi'
import { Button } from '@/components/ui/button'
import { classifySigners, type VerifiedPackage } from '@/core/package'
import { hasTxService } from '@/core/tx-service'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useSafe } from '@/queries/safes'
import { useLoadedSettings, useSaveSettings } from '@/queries/settings'
import {
  usePostToTxService,
  useTxServiceCheckOnce,
  useTxServiceOn,
  useTxServicePull,
} from '@/queries/tx-service'
import type { PullResult } from './program'

const HOST = <span className="font-mono">api.safe.global</span>
export const SAFE_WALLET = 'Safe{Wallet}'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What a pull left out of the queue, and why (SPEC §3.15). */
function pullNotes(r: PullResult): string[] {
  const notes: string[] = []
  if (r.rejected)
    notes.push(
      `${r.rejected} rejected because ${r.rejected === 1 ? 'its' : 'their'} hash didn't match`,
    )
  if (r.unsupportedSignatures)
    notes.push(
      `${plural(r.unsupportedSignatures, 'signature')} skipped (eth_sign or contract signatures)`,
    )
  return notes
}

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/**
 * Above the queue: an offer to check Safe's Transaction Service while it's off, otherwise one
 * short status line. What it finds is shown in the queue list itself.
 */
export function TxServiceQueueStatus({ snapshot }: { snapshot: SafeSnapshot | undefined }) {
  const on = useTxServiceOn()
  const settings = useLoadedSettings()
  const save = useSaveSettings()
  const pull = useTxServicePull(snapshot)
  const checkOnce = useTxServiceCheckOnce()
  if (!snapshot || !hasTxService(snapshot.chainId)) return null
  if (snapshot.authenticity.status !== 'verified') return null
  const turnOn = () =>
    save.mutate({
      ...settings,
      capabilities: { ...settings.capabilities, safeTransactionService: true },
    })
  const checking = pull.isFetching || checkOnce.isPending
  const error = pull.error ?? checkOnce.error

  if (!on && !pull.data && !checking) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm">
        <p>
          <span className="font-medium">Co-signers on {SAFE_WALLET}?</span>{' '}
          <span className="text-muted-foreground">
            Their transactions are on {HOST}, which Plain Safe only contacts when you ask.
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => checkOnce.mutate(snapshot)}>
            Check once
          </Button>
          <Button variant="outline" size="sm" disabled={save.isPending} onClick={turnOn}>
            Always check
          </Button>
        </div>
        {error && <p className="text-destructive">{describeError(error)}</p>}
      </div>
    )
  }

  const notes = pull.data ? pullNotes(pull.data) : []
  return (
    <div
      className="flex flex-col gap-1 text-xs text-muted-foreground"
      data-testid="tx-service-sync"
    >
      <div className="flex min-h-8 items-center gap-2">
        <span className="min-w-0 flex-1">
          {checking ? (
            `Checking ${SAFE_WALLET}'s queue…`
          ) : error ? (
            <span className="text-destructive">{describeError(error)}</span>
          ) : pull.data ? (
            `${on ? `Includes ${SAFE_WALLET}` : `${SAFE_WALLET} checked once`} · ${time(pull.dataUpdatedAt)}`
          ) : null}
        </span>
        {!on && (
          <button
            type="button"
            className="shrink-0 underline underline-offset-4"
            disabled={save.isPending}
            onClick={turnOn}
          >
            Always check
          </button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={`Check ${SAFE_WALLET} again`}
          disabled={checking}
          onClick={() => (on ? void pull.refetch() : checkOnce.mutate(snapshot))}
        >
          <RefreshCw className={cn('size-4', checking && 'animate-spin')} />
        </Button>
      </div>
      {notes.length > 0 && <p>{notes.join('; ')}.</p>}
    </div>
  )
}

/** On the review screen: add this transaction and its owner signatures to Safe{Wallet}'s queue. */
export function TxServicePost({ v }: { v: VerifiedPackage }) {
  const on = useTxServiceOn()
  const connection = useConnection()
  const safe = useSafe(v.pkg.chainId, v.pkg.safe)
  const post = usePostToTxService()
  const owners = safe.data?.owners
  if (!hasTxService(v.pkg.chainId) || !owners) return null
  if (safe.data?.authenticity.status !== 'verified') return null
  // An executed or replaced nonce can't be executed again, so there is nothing to share
  if (safe.data.nonce !== undefined && v.tx.nonce < safe.data.nonce) return null
  const ownerSigs = classifySigners(v.signatures, owners).owners.length
  if (ownerSigs === 0) return null

  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4" data-testid="tx-service-post">
      <h2 className="font-medium">Co-signers on {SAFE_WALLET}?</h2>
      <p className="text-sm text-muted-foreground">
        Post this transaction and its {plural(ownerSigs, 'owner signature')} to Safe's Transaction
        Service ({HOST}), so it shows up in their queue.
        {on ? '' : ' This sends one request now; it stays off otherwise.'}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={post.isPending}
          onClick={() =>
            post.mutate({ v, owners, preferredProposer: connection.address ?? undefined })
          }
        >
          {post.isPending ? 'Posting…' : 'Post to Safe Transaction Service'}
        </Button>
        {post.data && (
          <span className="text-sm">
            {post.data.proposed
              ? `Proposed, with ${plural(post.data.confirmed + 1, 'signature')}.`
              : post.data.confirmed > 0
                ? `Added ${plural(post.data.confirmed, 'signature')}.`
                : 'It already had every signature.'}
          </span>
        )}
      </div>
      {post.error && <p className="text-sm text-destructive">{describeError(post.error)}</p>}
    </section>
  )
}
