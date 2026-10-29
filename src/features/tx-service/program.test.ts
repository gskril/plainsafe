import { Effect, Layer } from 'effect'
import { type Address, zeroAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'
import { makePackage } from '@/core/package'
import { type SafeTx, safeTxTypedData } from '@/core/safe-tx'
import { PULL_LIMIT } from '@/core/tx-service'
import { RpcError } from '@/effect/errors'
import { Rpc } from '@/effect/rpc'
import { listPackages } from '@/features/queue/store'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { makeStorage, memoryBackend, Storage } from '@/storage/service'
import { mergePulls, pullFromService } from './program'

// A mocked Transaction Service: every request it gets, and the pages it serves
const service = vi.hoisted(() => ({
  urls: [] as string[],
  records: [] as unknown[],
}))
vi.mock('@/netguard', () => ({
  netguard: {
    fetchFor: () => async (url: string) => {
      service.urls.push(url)
      const offset = Number(new URL(url).searchParams.get('offset'))
      const limit = Number(new URL(url).searchParams.get('limit'))
      const results = service.records.slice(offset, offset + limit)
      return Response.json({
        count: service.records.length,
        next: 'https://evil.example/',
        results,
      })
    },
  },
}))

const CHAIN = 1
const SAFE: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const NONCE = 5n
// Throwaway keys only
const owner = privateKeyToAccount(generatePrivateKey())
const delegate = privateKeyToAccount(generatePrivateKey())

const tx = (nonce: bigint, value: bigint): SafeTx => ({
  to: delegate.address,
  value,
  data: '0x',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce,
})

/** A service record for `t`, with its real safeTxHash and an EOA signature from `signer`. */
async function record(t: SafeTx, signer = delegate) {
  const { hashes } = makePackage({ chainId: CHAIN, safe: SAFE, safeVersion: '1.4.1', tx: t })
  return {
    safe: SAFE,
    to: t.to,
    value: t.value.toString(),
    data: null,
    operation: t.operation,
    gasToken: t.gasToken,
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    refundReceiver: t.refundReceiver,
    nonce: t.nonce.toString(),
    safeTxHash: hashes.safeTx,
    isExecuted: false,
    confirmations: [
      {
        owner: signer.address,
        signature: await signer.signTypedData(safeTxTypedData(CHAIN, SAFE, t)),
        signatureType: 'EOA',
      },
    ],
  }
}

const snapshot = {
  chainId: CHAIN,
  address: SAFE,
  block: 100n,
  authenticity: { status: 'verified', version: '1.4.1' },
  singleton: zeroAddress,
  owners: [owner.address],
  threshold: 1n,
  nonce: NONCE,
  balance: 0n,
} as unknown as SafeSnapshot

function setup() {
  // Onchain approvals can't be read here; the pull shows those transactions unsaved instead
  const noRpc = Effect.fail(new RpcError({ endpoint: 'test', message: 'no RPC in tests' }))
  const layer = Layer.merge(
    Layer.succeed(Storage, makeStorage(memoryBackend())),
    Layer.succeed(Rpc, { chain: () => noRpc, client: () => noRpc }),
  )
  return <A, E>(eff: Effect.Effect<A, E, Storage | Rpc>) =>
    Effect.runPromise(Effect.provide(eff, layer))
}

describe('pullFromService paging (SPEC §3.15)', () => {
  it('says when a first page of junk hides a signed transaction, and loads it on request', async () => {
    const run = setup()
    service.urls = []
    service.records = [
      ...(await Promise.all(
        Array.from({ length: PULL_LIMIT }, (_, i) => record(tx(NONCE, BigInt(i + 1)))),
      )),
      await record(tx(NONCE + 1n, 0n), owner),
    ]
    const legit = (service.records[PULL_LIMIT] as { safeTxHash: string }).safeTxHash

    const first = await run(pullFromService(snapshot))
    expect(first).toMatchObject({ checked: PULL_LIMIT, total: PULL_LIMIT + 1, hasMore: true })
    expect(first.onService).not.toContain(legit)
    expect(first.unsaved).toHaveLength(PULL_LIMIT) // the delegate isn't an owner
    expect((await run(listPackages(CHAIN, SAFE))).packages).toHaveLength(0)

    // "Load more": one request for the next page, built by us, through the same checks
    const more = mergePulls(first, await run(pullFromService(snapshot, first.checked)))
    expect(service.urls).toHaveLength(2)
    expect(service.urls[1]).toContain(`&offset=${PULL_LIMIT}`)
    expect(service.urls.every((u) => u.startsWith('https://api.safe.global/'))).toBe(true)
    expect(more).toMatchObject({ checked: PULL_LIMIT + 1, total: PULL_LIMIT + 1, hasMore: false })
    expect(more.onService).toContain(legit)
    expect(more.unsaved).toHaveLength(PULL_LIMIT)
    const saved = (await run(listPackages(CHAIN, SAFE))).packages
    expect(saved.map((p) => p.verified.hashes.safeTx)).toEqual([legit])
  })

  it('has no more to load when everything fit on one page, or a page comes back empty', async () => {
    const run = setup()
    service.records = [await record(tx(NONCE, 0n), owner)]
    expect(await run(pullFromService(snapshot))).toMatchObject({ checked: 1, hasMore: false })
    expect(await run(pullFromService(snapshot, 5))).toMatchObject({ checked: 5, hasMore: false })
  })
})
