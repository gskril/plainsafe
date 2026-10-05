import { Effect, Layer } from 'effect'
import { type Address, zeroAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { makePackage, verifyPackage } from '@/core/package'
import { type SafeTx, safeTxTypedData } from '@/core/safe-tx'
import { packageKey } from '@/schemas/stored-package'
import { makeStorage, memoryBackend, Storage } from '@/storage/service'
import { listPackages, savePackage } from './store'

const SAFE: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const OTHER_SAFE: Address = '0x255C3912f91eF11bFDadd405F13144a823Da8cc5'
const tx: SafeTx = {
  to: OTHER_SAFE,
  value: 1n,
  data: '0x',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: 3n,
}

function setup() {
  const backend = memoryBackend()
  const layer = Layer.succeed(Storage, makeStorage(backend))
  const run = <A, E>(eff: Effect.Effect<A, E, Storage>) =>
    Effect.runPromise(Effect.provide(eff, layer))
  return { backend, run }
}

// Throwaway keys only
async function verified(chainId: number, safe: Address) {
  const account = privateKeyToAccount(generatePrivateKey())
  const signature = {
    signer: account.address,
    kind: 'eip712' as const,
    data: await account.signTypedData(safeTxTypedData(chainId, safe, tx)),
  }
  const v = await verifyPackage(
    makePackage({ chainId, safe, safeVersion: '1.4.1', tx, signatures: [signature] }),
  )
  if (v._tag === 'Left') throw new Error(v.left._tag)
  return v.right
}

describe('stored packages (SPEC §3.9)', () => {
  it("lists only this Safe's packages, and reports only its invalid records", async () => {
    const { backend, run } = setup()
    const mine = await verified(11155111, SAFE)
    await run(savePackage(mine, 'created'))
    await run(savePackage(await verified(11155111, OTHER_SAFE), 'created'))
    await run(savePackage(await verified(1, SAFE), 'created'))
    await backend.put('packages', packageKey(11155111, SAFE, `0x${'1'.repeat(64)}`), { bad: 1 })
    await backend.put('packages', packageKey(1, SAFE, `0x${'2'.repeat(64)}`), { bad: 2 })

    const { packages, invalid } = await run(listPackages(11155111, SAFE))
    expect(packages.map((p) => p.verified.hashes.safeTx)).toEqual([mine.hashes.safeTx])
    expect(invalid.map((e) => e.key)).toEqual([packageKey(11155111, SAFE, `0x${'1'.repeat(64)}`)])
  })

  it('merges signatures into a stored package with the same safeTxHash', async () => {
    const { run } = setup()
    const a = await verified(11155111, SAFE)
    const b = await verified(11155111, SAFE)
    expect(await run(savePackage(a, 'tx-service'))).toEqual({ added: 1, isNew: true })
    expect(await run(savePackage(b, 'imported'))).toEqual({ added: 1, isNew: false })
    const { packages } = await run(listPackages(11155111, SAFE))
    expect(packages[0]?.verified.signatures.map((s) => s.signer).sort()).toEqual(
      [a.signatures[0]?.signer, b.signatures[0]?.signer].sort(),
    )
    // The first source is kept: it says where this browser first got the package
    expect(packages[0]?.source).toBe('tx-service')
  })

  it("keeps what's stored (note, createdAt) when the same transaction is saved again", async () => {
    const { run } = setup()
    const a = await verified(11155111, SAFE)
    const first = {
      ...a,
      pkg: { ...a.pkg, note: 'Pay March invoice', createdAt: '2026-09-01T00:00:00Z' },
    }
    await run(savePackage(first, 'imported'))
    const b = await verified(11155111, SAFE)
    const again = { ...b, pkg: { ...b.pkg, note: 'Different note from the service' } }
    await run(savePackage(again, 'tx-service'))
    const { packages } = await run(listPackages(11155111, SAFE))
    expect(packages[0]?.verified.pkg.note).toBe('Pay March invoice')
    expect(packages[0]?.verified.pkg.createdAt).toBe('2026-09-01T00:00:00Z')
    expect(packages[0]?.verified.signatures).toHaveLength(2)
    expect(packages[0]?.source).toBe('imported')
  })
})
