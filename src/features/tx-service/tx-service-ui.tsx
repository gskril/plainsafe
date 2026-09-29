// Safe Transaction Service in the UI (SPEC §3.15): a line on the queue, and posting from the
// review screen. Off by default; each place says which host it would contact before it does.

import { useConnection } from 'wagmi'
import { Link } from 'wouter'
import { Button } from '@/components/ui/button'
import { classifySigners, type VerifiedPackage } from '@/core/package'
import { hasTxService } from '@/core/tx-service'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { describeError } from '@/lib/errors'
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** One sentence for a pull: what was found, and what was left out and why. */
export function pullText(r: PullResult): string {
  const parts = [
    r.found === 0
      ? 'It has no pending transactions for this Safe.'
      : `It has ${plural(r.found, 'pending transaction')}: ${r.added} new to this browser, ${plural(r.signatures, 'signature')} added.`,
  ]
  if (r.unsigned)
    parts.push(
      `${r.unsigned} not saved because no current owner has signed ${r.unsigned === 1 ? 'it' : 'them'} yet.`,
    )
  if (r.rejected)
    parts.push(
      `${r.rejected} rejected: ${r.rejected === 1 ? 'its' : 'their'} hash didn't match ${r.rejected === 1 ? 'its' : 'their'} contents.`,
    )
  if (r.unsupportedSignatures)
    parts.push(
      `${plural(r.unsupportedSignatures, 'signature')} skipped (eth_sign or contract signatures, which Plain Safe doesn't use).`,
    )
  return parts.join(' ')
}

/** On the queue screen: pull pending transactions made in Safe{Wallet}. */
export function TxServiceQueueSync({ snapshot }: { snapshot: SafeSnapshot | undefined }) {
  const on = useTxServiceOn()
  const settings = useLoadedSettings()
  const save = useSaveSettings()
  const pull = useTxServicePull(snapshot)
  const checkOnce = useTxServiceCheckOnce()
  if (!snapshot || !hasTxService(snapshot.chainId)) return null
  if (snapshot.authenticity.status !== 'verified') return null

  if (on) {
    return (
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm"
        data-testid="tx-service-sync"
      >
        <span className="font-medium">Safe Transaction Service</span>
        <span className="flex-1 text-muted-foreground">
          {pull.isFetching
            ? 'Checking…'
            : pull.error
              ? describeError(pull.error)
              : pull.data
                ? pullText(pull.data)
                : ''}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={pull.isFetching}
          onClick={() => void pull.refetch()}
        >
          Check again
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm">
      <p className="text-muted-foreground">
        Co-signers using Safe{'{'}Wallet{'}'}? Their transactions are on Safe's Transaction Service
        ({HOST}), which Plain Safe doesn't contact unless you ask. Anything it returns is checked
        here like a shared link.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={checkOnce.isPending}
          onClick={() => checkOnce.mutate(snapshot)}
        >
          Check once
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              ...settings,
              capabilities: { ...settings.capabilities, safeTransactionService: true },
            })
          }
        >
          Always check
        </Button>
        <Link href="/settings/network" className="text-xs underline underline-offset-4">
          Network access
        </Link>
      </div>
      {checkOnce.data && <p>{pullText(checkOnce.data)}</p>}
      {checkOnce.error && <p className="text-destructive">{describeError(checkOnce.error)}</p>}
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
      <h2 className="font-medium">
        Co-signers on Safe{'{'}Wallet{'}'}?
      </h2>
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
