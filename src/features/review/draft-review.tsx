// #/safe/:chainId/:address/review: the builder's unsaved draft (SPEC §9.4).
import { Either } from 'effect'
import { Share2 } from 'lucide-react'
import { Link, Redirect, useLocation } from 'wouter'
import { NotFound } from '@/components/layout/placeholder'
import { Button } from '@/components/ui/button'
import { makePackage, verifyPackage } from '@/core/package'
import { signingRefused } from '@/core/safety-rules'
import { clearDraft, type Draft, getDraft } from '@/features/builder/draft'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { useSafeParams } from '@/features/safes/safe-overview'
import { useSavePackage } from '@/queries/packages'
import type { PackageSignature } from '@/schemas/package'
import { useSignSafeTx } from '@/wallet/use-sign'
import { ReviewScreen } from './review-screen'
import { SignButton } from './sign-actions'

export function DraftReview() {
  const target = useSafeParams()
  if (!target) return <NotFound />
  const draft = getDraft(target.chainId, target.address)
  // A reload loses the in-memory draft: go back to the builder.
  if (!draft) return <Redirect to={`/safe/${target.chainId}/${target.address}/new`} replace />
  return <DraftReviewFor draft={draft} />
}

function DraftReviewFor({ draft }: { draft: Draft }) {
  const [, navigate] = useLocation()
  const sign = useSignSafeTx()
  const save = useSavePackage()
  const base = `/safe/${draft.chainId}/${draft.safe}`

  /** Save the draft as a package (optionally with a signature) and open it. */
  const store = async (safe: SafeSnapshot, signatures: PackageSignature[]) => {
    if (safe.authenticity.status !== 'verified') return
    const pkg = makePackage({
      chainId: draft.chainId,
      safe: draft.safe,
      safeVersion: safe.authenticity.version,
      tx: draft.tx,
      signatures,
    })
    const v = await verifyPackage(pkg)
    if (Either.isLeft(v)) throw new Error(`Couldn't store the transaction: ${v.left._tag}`)
    await save.mutateAsync(v.right)
    clearDraft(draft.chainId, draft.safe)
    navigate(`${base}/tx/${v.right.hashes.safeTx}`)
  }

  return (
    <ReviewScreen
      chainId={draft.chainId}
      safeAddress={draft.safe}
      tx={draft.tx}
      description={draft.description}
      actions={({ safe, banners, pending, simulationFailed }) => (
        <div className="flex flex-col gap-3">
          <SignButton
            banners={banners}
            simulationFailed={simulationFailed}
            safe={safe}
            pending={pending}
            signers={[]}
            busy={sign.isPending || save.isPending}
            error={sign.error ?? save.error}
            onSign={() => {
              if (!safe) return
              void sign
                .mutateAsync({ chainId: draft.chainId, safe: draft.safe, tx: draft.tx })
                .then((s) => store(safe, [s]))
                .catch(() => undefined)
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" asChild>
              <Link href={`${base}/new/${draft.preset}`}>Edit</Link>
            </Button>
            <Button
              variant="outline"
              disabled={!safe || !banners || signingRefused(banners) || save.isPending}
              onClick={() => safe && void store(safe, []).catch(() => undefined)}
            >
              <Share2 /> Share without signing
            </Button>
          </div>
        </div>
      )}
    />
  )
}
