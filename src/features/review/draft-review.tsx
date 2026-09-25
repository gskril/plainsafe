// #/safe/:chainId/:address/review: the builder's unsaved draft (SPEC §9.4).
import { Redirect } from 'wouter'
import { NotFound } from '@/components/layout/placeholder'
import { safeTxHashes } from '@/core/safe-tx'
import { getDraft } from '@/features/builder/draft'
import { useSafeParams } from '@/features/safes/safe-overview'
import { HashesPanel } from './hashes'
import { TxFields } from './tx-fields'

export function DraftReview() {
  const target = useSafeParams()
  if (!target) return <NotFound />
  const draft = getDraft(target.chainId, target.address)
  // A reload loses the in-memory draft: go back to the builder.
  if (!draft) return <Redirect to={`/safe/${target.chainId}/${target.address}/new`} replace />
  const hashes = safeTxHashes(draft.chainId, draft.safe, draft.tx)
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Review</h1>
      <p className="text-lg" data-testid="summary">
        {draft.description}
      </p>
      <TxFields chainId={draft.chainId} tx={draft.tx} />
      <HashesPanel hashes={hashes} />
    </div>
  )
}
