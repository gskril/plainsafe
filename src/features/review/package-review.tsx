// #/safe/:chainId/:address/tx/:safeTxHash: a stored package (SPEC §3.4–§3.8).
import { Either } from 'effect'
import { type Hex, isHex } from 'viem'
import { useParams } from 'wouter'
import { NotFound } from '@/components/layout/placeholder'
import { mergeSignatures, type RejectedSignature, verifyPackage } from '@/core/package'
import { useSafeParams } from '@/features/safes/safe-overview'
import { SharePanel } from '@/features/share/share-panel'
import { describeError } from '@/lib/errors'
import { usePackage, useSavePackage } from '@/queries/packages'
import { useSafe } from '@/queries/safes'
import type { PackageSignature } from '@/schemas/package'
import { useSignSafeTx } from '@/wallet/use-sign'
import { Callout } from './banners'
import { ReviewScreen } from './review-screen'
import { SignButton } from './sign-actions'
import { SignatureProgress } from './signature-progress'

export function PackageReview() {
  const target = useSafeParams()
  const { safeTxHash } = useParams<{ safeTxHash: string }>()
  if (!target || !isHex(safeTxHash) || safeTxHash.length !== 66) return <NotFound />
  return <Loaded chainId={target.chainId} safe={target.address} safeTxHash={safeTxHash as Hex} />
}

function Loaded({
  chainId,
  safe,
  safeTxHash,
}: {
  chainId: number
  safe: `0x${string}`
  safeTxHash: Hex
}) {
  const stored = usePackage(chainId, safe, safeTxHash)
  const sign = useSignSafeTx()
  const save = useSavePackage()
  if (stored.isPending)
    return <p className="mx-auto max-w-2xl px-4 py-8 text-muted-foreground">Loading…</p>
  if (stored.error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-destructive">
          {(stored.error as { _tag?: string })._tag === 'PackageNotFound'
            ? "This transaction isn't in this browser's queue. Open the shared link or file again to import it."
            : describeError(stored.error)}
        </p>
      </div>
    )
  }
  const { verified, execution } = stored.data
  const { pkg, tx } = verified

  const onSign = async () => {
    const signature = await sign.mutateAsync({ chainId, safe, tx })
    const next = await verifyPackage({
      ...pkg,
      signatures: mergeSignatures(pkg.signatures, [signature]),
    })
    if (Either.isLeft(next)) throw new Error(`Couldn't add the signature: ${next.left._tag}`)
    await save.mutateAsync(next.right)
  }

  return (
    <ReviewScreen
      chainId={chainId}
      safeAddress={safe}
      tx={tx}
      note={pkg.note}
      actions={({ safe: snapshot, banners, pending }) =>
        execution ? null : (
          <SignButton
            banners={banners}
            safe={snapshot}
            pending={pending}
            signers={verified.signatures.map((s) => s.signer)}
            onSign={() => void onSign().catch(() => undefined)}
            busy={sign.isPending || save.isPending}
            error={sign.error ?? save.error}
          />
        )
      }
    >
      {execution && (
        <Callout
          severity={execution.status === 'executed' ? 'info' : 'red'}
          title={execution.status === 'executed' ? 'Executed' : 'Execution failed'}
        >
          Transaction {execution.txHash}
        </Callout>
      )}
      <SignatureProgressFor
        chainId={chainId}
        safeAddress={safe}
        signatures={verified.signatures}
        rejected={verified.rejected}
      />
      <SharePanel pkg={pkg} />
    </ReviewScreen>
  )
}

function SignatureProgressFor(props: {
  chainId: number
  safeAddress: `0x${string}`
  signatures: readonly PackageSignature[]
  rejected: readonly RejectedSignature[]
}) {
  const safe = useSafe(props.chainId, props.safeAddress)
  return (
    <SignatureProgress
      chainId={props.chainId}
      safe={safe.data}
      signatures={props.signatures}
      rejected={props.rejected}
    />
  )
}
