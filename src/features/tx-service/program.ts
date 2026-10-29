// Safe Transaction Service programs (SPEC §3.15): pull pending transactions into the local queue,
// post our signatures, and open a Safe{Wallet} link. Every record from the service is treated like
// a shared package: hashes recomputed, signatures recovered, owners checked against the chain.
import { Effect, Either } from 'effect'
import { type Address, getAddress, type Hex } from 'viem'
import { type VerifiedPackage, verifyPackage, withOwnerSignaturesOnly } from '@/core/package'
import {
  packageFromService,
  planPost,
  type SafeWalletLink,
  serviceVersion,
} from '@/core/tx-service'
import { TxServiceError } from '@/effect/errors'
import { readApprovalsMany } from '@/features/execute/approvals'
import { savePackage } from '@/features/queue/store'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import type { SafeTxPackage } from '@/schemas/package'
import type { ServiceTx } from '@/schemas/tx-service'
import { confirmTx, fetchPending, fetchServiceSafe, fetchServiceTx, proposeTx } from './client'

export interface PullResult {
  /** The safeTxHash of every pending transaction the service returned that passed the checks. */
  readonly onService: readonly Hex[]
  /**
   * Checked transactions no current owner has signed or approved onchain yet. They're shown in
   * the queue but not saved until opened, so anyone the service lets propose (delegates) can't
   * fill this browser's storage with unsigned transactions.
   */
  readonly unsaved: readonly VerifiedPackage[]
  /**
   * Records that couldn't be read, whose claimed safeTxHash doesn't match their contents, or that
   * name another Safe.
   */
  readonly rejected: number
  /** Signatures of a kind Plain Safe doesn't use (eth_sign, contract signatures). */
  readonly unsupportedSignatures: number
}

/**
 * Pending transactions at or after the Safe's onchain nonce. Those with a valid signature or an
 * onchain approval from a current owner are saved to the queue (merged by safeTxHash); the rest
 * are returned unsaved.
 */
export const pullFromService = (snapshot: SafeSnapshot) =>
  Effect.gen(function* () {
    const a = snapshot.authenticity
    if (a.status !== 'verified' || snapshot.nonce === undefined || !snapshot.owners)
      return yield* new TxServiceError({ message: 'this Safe must be verified first.' })
    const { records, malformed } = yield* fetchPending(
      snapshot.chainId,
      snapshot.address,
      snapshot.nonce,
    )
    const onService: Hex[] = []
    const unsigned: VerifiedPackage[] = []
    let rejected = malformed
    let unsupportedSignatures = 0
    for (const t of records) {
      if (getAddress(t.safe) !== snapshot.address) {
        rejected++
        continue
      }
      // A record the schema let through can still fail to hash; it's rejected, not fatal.
      const built = tryPackageFromService(snapshot.chainId, a.version, t)
      if (Either.isLeft(built)) {
        rejected++
        continue
      }
      const { pkg, skipped } = built.right
      unsupportedSignatures += skipped
      if (pkg.hashes.safeTx.toLowerCase() !== t.safeTxHash.toLowerCase()) {
        rejected++
        continue
      }
      const v = yield* Effect.promise(() => verifyPackage(pkg))
      if (Either.isLeft(v)) {
        rejected++
        continue
      }
      onService.push(v.right.hashes.safeTx)
      // Anyone can post a signature to the service. Non-owner ones count for nothing, and kept
      // they could fill the package's signature cap and block real owners (SPEC §3.15).
      const owned = withOwnerSignaturesOnly(v.right, snapshot.owners)
      if (owned.signatures.length === 0) unsigned.push(owned)
      else yield* savePackage(owned, 'tx-service', snapshot.owners)
    }
    // An owner's onchain approval counts as their signature (SPEC §5.2). It's read from the chain
    // at the Safe's pinned block, never taken from the service's APPROVED_HASH confirmations. If
    // that read fails, those transactions are still shown, unsaved, rather than failing the pull
    // after other packages were already saved.
    const approvals = yield* Effect.orElseSucceed(
      readApprovalsMany(
        snapshot.chainId,
        snapshot.address,
        snapshot.owners,
        unsigned.map((v) => v.hashes.safeTx),
        snapshot.block,
      ),
      () => new Map<string, Address[]>(),
    )
    const unsaved: VerifiedPackage[] = []
    for (const v of unsigned) {
      if (approvals.get(v.hashes.safeTx.toLowerCase())?.length)
        yield* savePackage(v, 'tx-service', snapshot.owners)
      else unsaved.push(v)
    }
    return { onService, unsaved, rejected, unsupportedSignatures } satisfies PullResult
  })

export interface PostResult {
  readonly proposed: boolean
  readonly confirmed: number
}

/** Post the owner signatures the service doesn't have yet, proposing the transaction if needed. */
export const postToService = (
  v: VerifiedPackage,
  owners: readonly Address[],
  preferredProposer?: Address,
) =>
  Effect.gen(function* () {
    const { chainId } = v.pkg
    const safeTxHash = v.hashes.safeTx
    const remote = yield* fetchServiceTx(chainId, safeTxHash)
    const plan = planPost(
      v.signatures,
      owners,
      remote
        ? { exists: true, signers: remote.confirmations.map((c) => c.owner) }
        : { exists: false },
      preferredProposer,
    )
    if (!remote && !plan.propose)
      return yield* new TxServiceError({
        message: 'posting needs a signature from a current owner first.',
      })
    if (plan.propose) yield* proposeTx(v.pkg, plan.propose)
    for (const s of plan.confirm) yield* confirmTx(chainId, safeTxHash, s)
    return { proposed: !!plan.propose, confirmed: plan.confirm.length } satisfies PostResult
  })

/**
 * A Safe{Wallet} transaction link, fetched and rebuilt as a package. The caller opens it through
 * the normal import screen, which verifies it offline and then against the chain (SPEC §3.7).
 */
export const packageFromSafeWalletLink = (link: SafeWalletLink) =>
  Effect.gen(function* () {
    const t = yield* fetchServiceTx(link.chainId, link.safeTxHash)
    if (!t)
      return yield* new TxServiceError({
        status: 404,
        message: "doesn't have this transaction. It may have been deleted or replaced.",
      })
    if (getAddress(t.safe) !== link.safe)
      return yield* new TxServiceError({
        message: `returned a transaction for another Safe (${t.safe}).`,
      })
    // The version is only a display claim, so a failed lookup doesn't stop the import
    const info = yield* Effect.orElseSucceed(fetchServiceSafe(link.chainId, link.safe), () => null)
    const built = tryPackageFromService(link.chainId, serviceVersion(info?.version), t)
    if (Either.isLeft(built))
      return yield* new TxServiceError({
        message: `returned a transaction that could not be read: ${built.left}`,
      })
    const { pkg } = built.right
    if (!sameHash(pkg, link.safeTxHash) || !sameHash(pkg, t.safeTxHash))
      return yield* new TxServiceError({
        message: `returned a transaction whose contents hash to ${pkg.hashes.safeTx}, not ${link.safeTxHash}. It was not opened.`,
      })
    return pkg
  })

const sameHash = (pkg: SafeTxPackage, hash: Hex) =>
  pkg.hashes.safeTx.toLowerCase() === hash.toLowerCase()

/** packageFromService, with a throw (from ABI encoding or hashing) returned as its message. */
function tryPackageFromService(
  chainId: number,
  safeVersion: string,
  t: ServiceTx,
): Either.Either<ReturnType<typeof packageFromService>, string> {
  try {
    return Either.right(packageFromService(chainId, safeVersion, t))
  } catch (e) {
    return Either.left(e instanceof Error ? (e.message.split('\n')[0] ?? e.message) : String(e))
  }
}
