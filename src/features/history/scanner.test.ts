import { Effect, Layer } from 'effect'
import { type Address, encodeAbiParameters, encodeEventTopics, type Hex, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { safeEventsV141 } from '@/core/history'
import { HistoryCheckpoint, HistoryEvent, historyEventPrefix, historyKey } from '@/schemas/history'
import { makeStorage, memoryBackend, Storage } from '@/storage/service'
import { type HistoryClient, type HistoryLog, type ScanProgress, scanHistory } from './scanner'

const SAFE: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex
const execution = (block: bigint, n: number): HistoryLog => ({
  blockNumber: block,
  logIndex: 0,
  transactionHash: hash(1000 + n),
  topics: encodeEventTopics({
    abi: safeEventsV141,
    eventName: 'ExecutionSuccess',
    args: { txHash: hash(n) },
  }) as Hex[],
  data: encodeAbiParameters([{ type: 'uint256' }], [0n]),
})
const setupLog = (block: bigint): HistoryLog => ({
  blockNumber: block,
  logIndex: 1,
  transactionHash: hash(999),
  topics: encodeEventTopics({
    abi: safeEventsV141,
    eventName: 'SafeSetup',
    args: { initiator: SAFE },
  }) as Hex[],
  data: encodeAbiParameters(
    [{ type: 'address[]' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }],
    [[SAFE], 1n, zeroAddress, zeroAddress],
  ),
})

/** A chain with a Safe created at block 1000 and an RPC that refuses ranges over 3,000 blocks. */
function fakeChain(opts: { refuse?: boolean; flaky?: boolean } = {}) {
  const state = {
    latest: 9_600n,
    finalized: 9_500n,
    nonce: 4n,
    logs: [
      setupLog(1_000n),
      execution(2_000n, 1),
      execution(5_000n, 2),
      execution(9_000n, 3),
      execution(9_550n, 4),
    ],
    calls: [] as [bigint, bigint][],
  }
  const client: HistoryClient = {
    latestBlock: async () => state.latest,
    finalizedBlock: async () => state.finalized,
    nonce: async () => state.nonce,
    getLogs: async ({ fromBlock, toBlock }) => {
      state.calls.push([fromBlock, toBlock])
      if (opts.refuse) throw new Error('4444 pruned history unavailable')
      // The first two calls fail, the way MEV Blocker's getLogs does at times
      if (opts.flaky && state.calls.length <= 2) throw new Error('service temporarily unavailable')
      if (toBlock - fromBlock + 1n > 3_000n) throw new Error('query exceeds max block range 3000')
      return state.logs.filter(
        (l) => l.blockNumber !== null && l.blockNumber >= fromBlock && l.blockNumber <= toBlock,
      )
    },
  }
  return { state, client }
}

function setup() {
  const backend = memoryBackend()
  const layer = Layer.succeed(Storage, makeStorage(backend))
  const run = <A, E>(eff: Effect.Effect<A, E, Storage>) =>
    Effect.runPromise(Effect.provide(eff, layer))
  return { run }
}
const target = { chainId: 1, safe: SAFE, version: '1.4.1', floor: 500n, rpcUrl: 'https://rpc' }
const hooks = (cancelAfter = Number.POSITIVE_INFINITY) => {
  const seen: ScanProgress[] = []
  return {
    seen,
    onProgress: (p: ScanProgress) => seen.push(p),
    cancelled: () => seen.length >= cancelAfter,
  }
}
const stored = (run: ReturnType<typeof setup>['run']) =>
  run(
    Effect.gen(function* () {
      const s = yield* Storage
      const events = yield* s.getAllWithPrefix(
        'history_events',
        historyEventPrefix(1, SAFE),
        HistoryEvent,
      )
      const cp = yield* s.get('history_checkpoints', historyKey(1, SAFE), HistoryCheckpoint)
      return { events: events.records.map((r) => `${r.value.blockNumber}:${r.value.name}`), cp }
    }),
  )

describe('history scanner (SPEC §11)', () => {
  it('scans back to the creation, halving on range errors, with the tip kept apart', async () => {
    const { run } = setup()
    const { client, state } = fakeChain()
    const h = hooks()
    const result = await run(scanHistory(client, target, h))
    expect(result).toMatchObject({ status: 'complete', executions: 4, onchainNonce: 4n })
    const { events, cp } = await stored(run)
    expect(events).toEqual([
      '1000:SafeSetup',
      '2000:ExecutionSuccess',
      '5000:ExecutionSuccess',
      '9000:ExecutionSuccess',
    ])
    expect(cp._tag === 'Some' && cp.value.tip.map((e) => e.blockNumber)).toEqual(['9550'])
    // The first attempt (100,000 blocks) was too large; every accepted range was at most 3,000
    expect(state.calls[0]).toEqual([500n, 9_500n])
    expect(state.calls.every(([f, t]) => t >= f)).toBe(true)
  })

  it('stops when cancelled and resumes without re-reading what it stored', async () => {
    const { run } = setup()
    const { client, state } = fakeChain()
    const first = await run(scanHistory(client, target, hooks(1)))
    expect(first.status).toBe('stopped')
    const scannedDownTo = first.scannedDownTo as bigint
    state.calls = []
    const second = await run(scanHistory(client, target, hooks()))
    expect(second.status).toBe('complete')
    const backward = state.calls.filter(([, t]) => t <= state.finalized)
    expect(backward.every(([, t]) => t < scannedDownTo)).toBe(true)
  })

  it('catches up forward on the next run', async () => {
    const { run } = setup()
    const { client, state } = fakeChain()
    await run(scanHistory(client, target, hooks()))
    state.logs.push(execution(9_700n, 5))
    state.finalized = 9_800n
    state.latest = 9_900n
    state.nonce = 5n
    const r = await run(scanHistory(client, target, hooks()))
    expect(r).toMatchObject({ status: 'complete', executions: 5 })
    const { events } = await stored(run)
    expect(events).toContain('9550:ExecutionSuccess')
    expect(events).toContain('9700:ExecutionSuccess')
  })

  it('is incomplete when the floor is reached without the creation', async () => {
    const { run } = setup()
    const { client } = fakeChain()
    const r = await run(scanHistory(client, { ...target, floor: 1_500n }, hooks()))
    expect(r.status).toBe('incomplete')
  })

  it('retries temporary errors instead of giving up', async () => {
    const { run } = setup()
    const { client } = fakeChain({ flaky: true })
    const r = await run(scanHistory(client, target, hooks()))
    expect(r.status).toBe('complete')
  }, 10_000)

  it('is unavailable when the RPC refuses historical logs', async () => {
    const { run } = setup()
    const { client } = fakeChain({ refuse: true })
    const r = await run(scanHistory(client, target, hooks()))
    expect(r.status).toBe('unavailable')
    expect(r.reason).toMatch(/doesn't serve historical logs/)
  })
})
