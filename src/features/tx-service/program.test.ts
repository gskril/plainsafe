// pullFromService against a mocked service response (SPEC §3.15): only current owners'
// signatures are saved, so a service response can't fill a package's signature cap (issue #21).
import { Effect, Either, Layer, Schema } from 'effect'
import { type Address, type Hex, zeroAddress } from 'viem'
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makePackage, mergeSignatures, type VerifiedPackage, verifyPackage } from '@/core/package'
import { classifyQueue } from '@/core/queue'
import { type SafeTx, safeTxHashes, safeTxTypedData } from '@/core/safe-tx'
import { Rpc, type RpcApi } from '@/effect/rpc'
import { listPackages, savePackage } from '@/features/queue/store'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import type { PackageSignature } from '@/schemas/package'
import { ServiceTx } from '@/schemas/tx-service'
import { makeStorage, memoryBackend, Storage } from '@/storage/service'

const mocks = vi.hoisted(() => ({
  records: [] as unknown[],
  approvals: new Map<string, Address[]>(),
}))

vi.mock('./client', () => ({
  fetchPending: () => Effect.succeed({ records: mocks.records, malformed: 0 }),
  fetchServiceTx: () => Effect.die('not used'),
  fetchServiceSafe: () => Effect.die('not used'),
  proposeTx: () => Effect.die('not used'),
  confirmTx: () => Effect.die('not used'),
}))
vi.mock('@/features/execute/approvals', () => ({
  readApprovalsMany: () => Effect.succeed(mocks.approvals),
}))
// Nothing here makes a request; the Rpc module only needs netguard to load
vi.mock('@/netguard', () => ({ netguard: {} }))

const { pullFromService } = await import('./program')

const CHAIN = 11155111
const SAFE: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const txAt = (nonce: bigint): SafeTx => ({
  to: '0x255C3912f91eF11bFDadd405F13144a823Da8cc5',
  value: 1n,
  data: '0x',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce,
})

// Throwaway keys only
const account = () => privateKeyToAccount(generatePrivateKey())
const ownerA = account()
const ownerB = account()
const OWNERS = [ownerA.address, ownerB.address]

const snapshot = {
  chainId: CHAIN,
  address: SAFE,
  block: 100n,
  authenticity: { status: 'verified', version: '1.4.1' } as SafeSnapshot['authenticity'],
  singleton: zeroAddress,
  owners: OWNERS,
  threshold: 2n,
  nonce: 3n,
  balance: 0n,
} satisfies SafeSnapshot

const sign = async (a: PrivateKeyAccount, tx: SafeTx): Promise<PackageSignature> => ({
  signer: a.address,
  kind: 'eip712',
  data: await a.signTypedData(safeTxTypedData(CHAIN, SAFE, tx)),
})

const junk = (tx: SafeTx, n: number) =>
  Promise.all(Array.from({ length: n }, () => sign(account(), tx)))

/** A pending record as the service would send it. */
const serviceRecord = (tx: SafeTx, signatures: readonly PackageSignature[]) =>
  Schema.decodeUnknownSync(ServiceTx)({
    safe: SAFE,
    to: tx.to,
    value: tx.value.toString(),
    data: tx.data,
    operation: tx.operation,
    gasToken: tx.gasToken,
    safeTxGas: tx.safeTxGas.toString(),
    baseGas: tx.baseGas.toString(),
    gasPrice: tx.gasPrice.toString(),
    refundReceiver: tx.refundReceiver,
    nonce: tx.nonce.toString(),
    safeTxHash: safeTxHashes(CHAIN, SAFE, tx).safeTx,
    isExecuted: false,
    confirmations: signatures.map((s) => ({
      owner: s.signer,
      signature: s.data,
      signatureType: 'EOA',
    })),
  })

async function verified(tx: SafeTx, signatures: readonly PackageSignature[]) {
  const v = await verifyPackage(
    makePackage({ chainId: CHAIN, safe: SAFE, safeVersion: '1.4.1', tx, signatures }),
  )
  if (Either.isLeft(v)) throw new Error(v.left._tag)
  return v.right
}

function setup() {
  // The approvals read is mocked, so the Rpc service is never used
  const layer = Layer.merge(
    Layer.succeed(Storage, makeStorage(memoryBackend())),
    Layer.succeed(Rpc, {} as RpcApi),
  )
  const run = <A, E>(eff: Effect.Effect<A, E, Storage | Rpc>) =>
    Effect.runPromise(Effect.provide(eff, layer))
  const stored = async (hash: Hex) => {
    const { packages } = await run(listPackages(CHAIN, SAFE))
    return packages.find((p) => p.verified.hashes.safeTx === hash)?.verified
  }
  return { run, stored }
}

/** The sign path (useSignAndSave): merge the new signature, verify, save. */
async function signAndSave(
  run: ReturnType<typeof setup>['run'],
  v: VerifiedPackage,
  signature: PackageSignature,
) {
  const signatures = mergeSignatures(v.pkg.signatures, [signature], OWNERS)
  const next = await verifyPackage({ ...v.pkg, signatures })
  if (Either.isLeft(next)) throw new Error(next.left._tag)
  await run(savePackage(next.right, 'created', OWNERS))
}

const validSignatures = (v: VerifiedPackage) =>
  classifyQueue(
    [
      {
        safeTxHash: v.hashes.safeTx,
        nonce: v.tx.nonce,
        signers: v.signatures.map((s) => s.signer),
      },
    ],
    { nonce: snapshot.nonce, threshold: snapshot.threshold, owners: OWNERS },
  )[0]?.validSignatures

beforeEach(() => {
  mocks.records = []
  mocks.approvals = new Map()
})

describe('pullFromService keeps only owner signatures (SPEC §3.15)', () => {
  it('saves 1 owner signature out of 100, and the next owner can still sign', async () => {
    const { run, stored } = setup()
    const tx = txAt(3n)
    const hash = safeTxHashes(CHAIN, SAFE, tx).safeTx
    mocks.records = [serviceRecord(tx, [await sign(ownerA, tx), ...(await junk(tx, 99))])]

    const result = await run(pullFromService(snapshot))
    expect(result.rejected).toBe(0)
    expect(result.onService).toEqual([hash])
    const saved = await stored(hash)
    expect(saved?.signatures.map((s) => s.signer)).toEqual([ownerA.address])
    expect(saved && validSignatures(saved)).toBe(1)

    await signAndSave(run, saved as VerifiedPackage, await sign(ownerB, tx))
    const after = await stored(hash)
    expect(after?.signatures).toHaveLength(2)
    expect(after && validSignatures(after)).toBe(2)
  })

  it('drops non-owner signatures on the onchain-approval and unsaved paths too', async () => {
    const { run, stored } = setup()
    const approved = txAt(3n)
    const proposal = txAt(4n)
    const approvedHash = safeTxHashes(CHAIN, SAFE, approved).safeTx
    mocks.records = [
      serviceRecord(approved, await junk(approved, 5)),
      serviceRecord(proposal, await junk(proposal, 5)),
    ]
    mocks.approvals = new Map([[approvedHash.toLowerCase(), [ownerA.address]]])

    const result = await run(pullFromService(snapshot))
    expect((await stored(approvedHash))?.signatures).toEqual([])
    // Shown in the queue without them, so opening it (which saves it) doesn't bring them back
    expect(result.unsaved.map((v) => v.signatures.length)).toEqual([0])
    expect(result.unsaved[0]?.pkg.signatures).toEqual([])
  })
})

describe('repairing a package already filled with non-owner signatures', () => {
  // As saved before the fix: owner A's signature and 99 from non-owners, at the cap
  async function affected(run: ReturnType<typeof setup>['run'], tx: SafeTx) {
    const v = await verified(tx, [await sign(ownerA, tx), ...(await junk(tx, 99))])
    await run(savePackage(v, 'tx-service'))
    return v
  }

  it('saves a clean import over it, keeping only owner signatures', async () => {
    const { run, stored } = setup()
    const tx = txAt(3n)
    const v = await affected(run, tx)
    expect((await stored(v.hashes.safeTx))?.signatures).toHaveLength(100)
    expect(validSignatures(v)).toBe(1)

    const clean = await verified(tx, [await sign(ownerA, tx), await sign(ownerB, tx)])
    expect(await run(savePackage(clean, 'imported', OWNERS))).toEqual({ added: 1, isNew: false })
    const after = await stored(v.hashes.safeTx)
    expect(after?.signatures.map((s) => s.signer).sort()).toEqual([...OWNERS].sort())
  })

  it('lets the next owner sign it', async () => {
    const { run, stored } = setup()
    const tx = txAt(3n)
    const v = await affected(run, tx)
    await signAndSave(run, v, await sign(ownerB, tx))
    const after = await stored(v.hashes.safeTx)
    expect(after?.signatures.map((s) => s.signer).sort()).toEqual([...OWNERS].sort())
    expect(after && validSignatures(after)).toBe(2)
  })
})
