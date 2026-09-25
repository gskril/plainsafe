// #/safe/:chainId/:address/tx/:safeTxHash: a stored package (SPEC §3.4–§3.8).
import { Either } from 'effect'
import { ExternalLink } from 'lucide-react'
import { type Address, type Hex, isHex } from 'viem'
import { useLocation, useParams } from 'wouter'
import { explorerUrl } from '@/chains'
import { NotFound } from '@/components/layout/not-found'
import { Button } from '@/components/ui/button'
import { cancelTx, isCancel } from '@/core/builders'
import { mergeSignatures, type RejectedSignature, verifyPackage } from '@/core/package'
import type { SafeTx } from '@/core/safe-tx'
import { setDraft } from '@/features/builder/draft'
import { ExecutePanel } from '@/features/execute/execute-panel'
import { useSafeParams } from '@/features/safes/safe-overview'
import { SharePanel } from '@/features/share/share-panel'
import { describeError } from '@/lib/errors'
import { useApprovals, useApproveHash } from '@/queries/approvals'
import { usePackage, useSavePackage } from '@/queries/packages'
import { useSafe } from '@/queries/safes'
import { useLoadedSettings } from '@/queries/settings'
import type { PackageSignature } from '@/schemas/package'
import type { StoredPackage } from '@/schemas/stored-package'
import { useSignSafeTx } from '@/wallet/use-sign'
import { Callout } from './banners'
import { type ReviewContext, ReviewScreen } from './review-screen'
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
      actions={(ctx) =>
        execution ? null : (
          <PackageActions
            ctx={ctx}
            chainId={chainId}
            tx={tx}
            safeTxHash={verified.hashes.safeTx}
            signatures={verified.signatures}
            onSign={() => void onSign().catch(() => undefined)}
            busy={sign.isPending || save.isPending}
            error={sign.error ?? save.error}
          />
        )
      }
    >
      {execution && <ExecutionState chainId={chainId} execution={execution} />}
      <SignatureProgressFor
        chainId={chainId}
        safeAddress={safe}
        safeTxHash={verified.hashes.safeTx}
        signatures={verified.signatures}
        rejected={verified.rejected}
      />
      <SharePanel pkg={pkg} />
    </ReviewScreen>
  )
}

/** Sign, approve on-chain, or execute, with on-chain approvals counted (SPEC §5.2). */
function PackageActions(props: {
  ctx: ReviewContext
  chainId: number
  tx: SafeTx
  safeTxHash: Hex
  signatures: readonly PackageSignature[]
  onSign: () => void
  busy: boolean
  error: Error | null
}) {
  const { ctx, chainId, safeTxHash } = props
  const approvals = useApprovals(chainId, ctx.safe, safeTxHash)
  const approve = useApproveHash()
  return (
    <div className="flex flex-col gap-4">
      <SignButton
        banners={ctx.banners}
        simulationFailed={ctx.simulationFailed}
        safe={ctx.safe}
        pending={ctx.pending}
        signers={props.signatures.map((s) => s.signer)}
        approvedBy={approvals.data}
        onSign={props.onSign}
        busy={props.busy}
        error={props.error}
        onApprove={
          ctx.safe
            ? () => approve.mutate({ chainId, safe: ctx.safe?.address as Address, safeTxHash })
            : undefined
        }
        approveBusy={approve.isPending}
        approveError={approve.error}
      />
      {ctx.safe && (
        <ExecutePanel
          chainId={chainId}
          safe={ctx.safe}
          tx={props.tx}
          safeTxHash={safeTxHash}
          signatures={props.signatures}
          approvedBy={approvals.data}
        />
      )}
      {ctx.safe?.nonce !== undefined &&
        props.tx.nonce >= ctx.safe.nonce &&
        !isCancel(ctx.safe.address, props.tx) && (
          <CancelAction chainId={chainId} safe={ctx.safe.address} nonce={props.tx.nonce} />
        )}
    </div>
  )
}

/** A one-click cancel (P1): a new transaction at the same nonce that does nothing. */
function CancelAction({ chainId, safe, nonce }: { chainId: number; safe: Address; nonce: bigint }) {
  const [, navigate] = useLocation()
  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <Button
        variant="ghost"
        size="sm"
        data-testid="cancel-tx"
        onClick={() => {
          setDraft({
            chainId,
            safe,
            tx: cancelTx(safe, nonce),
            description: `Cancel: an empty call that uses up nonce ${nonce}`,
            preset: 'eth',
          })
          navigate(`/safe/${chainId}/${safe}/review`)
        }}
      >
        Cancel this transaction
      </Button>
      <p className="max-w-md text-xs text-muted-foreground">
        Creates an empty transaction at nonce {nonce.toString()}. Once it's signed and executed,
        nothing else at this nonce can execute. It needs the same number of signatures.
      </p>
    </div>
  )
}

function SignatureProgressFor(props: {
  chainId: number
  safeAddress: `0x${string}`
  safeTxHash: Hex
  signatures: readonly PackageSignature[]
  rejected: readonly RejectedSignature[]
}) {
  const safe = useSafe(props.chainId, props.safeAddress)
  const approvals = useApprovals(props.chainId, safe.data, props.safeTxHash)
  return (
    <SignatureProgress
      chainId={props.chainId}
      safe={safe.data}
      signatures={props.signatures}
      rejected={props.rejected}
      approvedBy={approvals.data}
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
