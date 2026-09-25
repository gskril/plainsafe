// #/safe/:chainId/:address/review: the builder's unsaved draft (SPEC §9.4).
import { Link, Redirect } from 'wouter'
import { NotFound } from '@/components/layout/placeholder'
import { Button } from '@/components/ui/button'
import { isUnverified, signingRefused } from '@/core/safety-rules'
import { getDraft } from '@/features/builder/draft'
import { useSafeParams } from '@/features/safes/safe-overview'
import { ReviewScreen } from './review-screen'

export function DraftReview() {
  const target = useSafeParams()
  if (!target) return <NotFound />
  const draft = getDraft(target.chainId, target.address)
  // A reload loses the in-memory draft: go back to the builder.
  if (!draft) return <Redirect to={`/safe/${target.chainId}/${target.address}/new`} replace />
  const base = `/safe/${draft.chainId}/${draft.safe}`
  return (
    <ReviewScreen
      chainId={draft.chainId}
      safeAddress={draft.safe}
      tx={draft.tx}
      description={draft.description}
      actions={({ banners, pending }) => (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" asChild>
            <Link href={`${base}/new/${draft.preset}`}>Edit</Link>
          </Button>
          <Button size="lg" disabled data-testid="main-action">
            {pending
              ? 'Checking…'
              : banners && signingRefused(banners)
                ? 'Signing refused'
                : banners && isUnverified(banners)
                  ? 'Sign unverified transaction'
                  : 'Sign'}
          </Button>
        </div>
      )}
    />
  )
}
