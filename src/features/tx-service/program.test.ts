import { Effect, Either } from 'effect'
import { getAddress, type Hex } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { RECORD } from '@/core/tx-service.fixtures'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import type { ServiceTx } from '@/schemas/tx-service'

// The service, the queue store and the approvals read are replaced; hashing and signature
// recovery are the real ones.
const pending: { records: ServiceTx[]; malformed: number } = { records: [], malformed: 0 }
let single: ServiceTx | null = null
const saved: string[] = []

vi.mock('./client', () => ({
  fetchPending: () => Effect.succeed(pending),
  fetchServiceTx: () => Effect.succeed(single),
  fetchServiceSafe: () => Effect.succeed({ address: RECORD.safe, version: '1.3.0+L2' }),
  confirmTx: () => Effect.succeed(undefined),
  proposeTx: () => Effect.succeed(undefined),
}))
vi.mock('@/features/queue/store', () => ({
  savePackage: (v: { hashes: { safeTx: string } }) =>
    Effect.sync(() => {
      saved.push(v.hashes.safeTx)
    }),
}))
vi.mock('@/features/execute/approvals', () => ({
  readApprovalsMany: () => Effect.succeed(new Map()),
}))

const { pullFromService, packageFromSafeWalletLink } = await import('./program')

const SAFE = getAddress(RECORD.safe)
const OWNER = getAddress('0x75d91395CD36f24f990bbdE69993cB20B96EcFa6')
const snapshot = {
  chainId: 1,
  address: SAFE,
  block: 1n,
  authenticity: { status: 'verified', version: '1.3.0' },
  singleton: SAFE,
  owners: [OWNER],
  threshold: 1n,
  nonce: 245n,
  balance: 0n,
} as unknown as SafeSnapshot

const good = RECORD as unknown as ServiceTx
// Past uint256 (as if the schema's bound were bypassed), so ABI encoding throws while hashing.
const overflowing = { ...good, value: (2n ** 256n).toString() } as ServiceTx

const run = <A>(e: Effect.Effect<A, unknown, unknown>) =>
  Effect.runPromise(Effect.either(e) as Effect.Effect<Either.Either<A, unknown>>)

describe('pullFromService', () => {
  it('rejects a record that fails to hash and still reads the valid one after it', async () => {
    pending.records = [overflowing, good]
    pending.malformed = 1
    saved.length = 0
    const r = await run(pullFromService(snapshot))
    if (Either.isLeft(r)) throw r.left
    expect(r.right.rejected).toBe(2)
    expect(r.right.onService).toEqual([RECORD.safeTxHash])
    expect(saved).toEqual([RECORD.safeTxHash])
  })
})

describe('packageFromSafeWalletLink', () => {
  const link = { chainId: 1, safe: SAFE, safeTxHash: RECORD.safeTxHash as Hex }

  it('turns a record that fails to hash into a TxServiceError, not a defect', async () => {
    single = overflowing
    const r = await run(packageFromSafeWalletLink(link))
    if (Either.isRight(r)) throw new Error('expected a failure')
    expect(r.left).toMatchObject({
      _tag: 'TxServiceError',
      message: expect.stringContaining('could not be read'),
    })
  })

  it('rebuilds a valid record', async () => {
    single = good
    const r = await run(packageFromSafeWalletLink(link))
    if (Either.isLeft(r)) throw r.left
    expect(r.right.hashes.safeTx).toBe(RECORD.safeTxHash)
  })
})
