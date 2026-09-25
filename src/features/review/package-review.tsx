// #/safe/:chainId/:address/tx/:safeTxHash: a stored package (SPEC §3.4–§3.8).
import { Either } from 'effect'
import { ExternalLink } from 'lucide-react'
import { type Hex, isHex } from 'viem'
import { useParams } from 'wouter'
import { explorerUrl } from '@/chains'
import { NotFound } from '@/components/layout/placeholder'
import { mergeSignatures, type RejectedSignature, verifyPackage } from '@/core/package'
import { ExecutePanel } from '@/features/execute/execute-panel'
import { useSafeParams } from '@/features/safes/safe-overview'
import { SharePanel } from '@/features/share/share-panel'
import { describeError } from '@/lib/errors'
import { usePackage, useSavePackage } from '@/queries/packages'
import { useSafe } from '@/queries/safes'
import { useLoadedSettings } from '@/queries/settings'
import type { PackageSignature } from '@/schemas/package'
import type { StoredPackage } from '@/schemas/stored-package'
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
          <div className="flex flex-col gap-4">
            <SignButton
              banners={banners}
              safe={snapshot}
              pending={pending}
              signers={verified.signatures.map((s) => s.signer)}
              onSign={() => void onSign().catch(() => undefined)}
              busy={sign.isPending || save.isPending}
              error={sign.error ?? save.error}
            />
            {snapshot && (
              <ExecutePanel
                chainId={chainId}
                safe={snapshot}
                tx={tx}
                safeTxHash={verified.hashes.safeTx}
                signatures={verified.signatures}
              />
            )}
          </div>
        )
      }
    >
      {execution && <ExecutionState chainId={chainId} execution={execution} />}
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

/** Recorded execution (SPEC §3.8): the explorer link comes from the chain config and is never fetched. */
function ExecutionState({
  chainId,
  execution,
}: {
  chainId: number
  execution: NonNullable<StoredPackage['execution']>
}) {
  const settings = useLoadedSettings()
  const chain = settings.chains.find((c) => c.id === chainId)
  const link = chain ? explorerUrl(chain, 'tx', execution.txHash) : undefined
  const ok = execution.status === 'executed'
  return (
    <div data-testid="execution-state" data-status={execution.status}>
      <Callout
        severity={ok ? 'info' : 'red'}
        title={ok ? 'Executed' : 'Executed, but the inner call failed (ExecutionFailure)'}
      >
        <span className="font-mono text-xs break-all">{execution.txHash}</span>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="ml-2 inline-flex items-center gap-1 underline"
          >
            explorer <ExternalLink className="size-3" />
          </a>
        )}
      </Callout>
    </div>
  )
}
