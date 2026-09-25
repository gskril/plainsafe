// The on-chain history scanner (SPEC §11): backwards from the finalized block until the Safe's
// SafeSetup (or the singleton's deploy block), chunk by chunk, each chunk's events and the
// checkpoint written in one transaction so a scan can stop anywhere and resume. Runs in the
// history worker; the client and the storage are passed in, so it runs in tests too.
import { Effect, Option, Schedule } from 'effect'
import type { Address, Hex } from 'viem'
import {
  classifyLogError,
  completeness,
  decodeSafeLog,
  INITIAL_CHUNK,
  isExecution,
  type LogErrorKind,
  largerChunk,
  smallerChunk,
} from '@/core/history'
import { errorInfo, shortMessage } from '@/core/rpc-errors'
import {
  HistoryCheckpoint,
  HistoryEvent,
  historyEventKey,
  historyEventPrefix,
  historyKey,
} from '@/schemas/history'
import { Storage, write } from '@/storage/service'

export interface HistoryLog {
  readonly blockNumber: bigint | null
  readonly logIndex: number | null
  readonly transactionHash: Hex | null
  readonly topics: readonly Hex[]
  readonly data: Hex
}

/** What the scanner needs from an RPC. */
export interface HistoryClient {
  readonly latestBlock: () => Promise<bigint>
  /** The `finalized` block, or undefined if the RPC doesn't support that tag. */
  readonly finalizedBlock: () => Promise<bigint | undefined>
  readonly getLogs: (a: {
    address: Address
    fromBlock: bigint
    toBlock: bigint
  }) => Promise<readonly HistoryLog[]>
  readonly nonce: (safe: Address) => Promise<bigint>
}

export interface ScanTarget {
  readonly chainId: number
  readonly safe: Address
  readonly version: string
  /** The singleton's deploy block (0 when unknown): below it there's nothing to find. */
  readonly floor: bigint
  readonly rpcUrl: string
}

export interface ScanProgress {
  readonly status: 'scanning' | 'complete' | 'incomplete' | 'unavailable' | 'stopped'
  readonly reason?: string
  readonly scannedDownTo?: bigint
  readonly finalizedHead?: bigint
  readonly floor: bigint
  readonly executions: number
  readonly onchainNonce?: bigint
}

class LogsFailed {
  readonly _tag = 'LogsFailed'
  constructor(
    readonly kind: LogErrorKind,
    readonly message: string,
  ) {}
}

/** Without a `finalized` tag, stay this far behind the tip (about Mainnet's finality). */
const FALLBACK_DEPTH = 96n

const toEvent = (log: HistoryLog, version: string): HistoryEvent | undefined => {
  if (log.blockNumber === null || log.logIndex === null || !log.transactionHash) return undefined
  const e = decodeSafeLog(log, version)
  if (!e) return undefined
  return {
    blockNumber: log.blockNumber.toString(),
    logIndex: log.logIndex,
    transactionHash: log.transactionHash,
    name: e.name,
    args: e.args,
  }
}

export const scanHistory = (
  client: HistoryClient,
  target: ScanTarget,
  hooks: { onProgress: (p: ScanProgress) => void; cancelled: () => boolean },
) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const key = historyKey(target.chainId, target.safe)
    const prefix = historyEventPrefix(target.chainId, target.safe)
    // An unreadable checkpoint is treated as none: the cache is rebuilt.
    const stored = yield* storage
      .get('history_checkpoints', key, HistoryCheckpoint)
      .pipe(Effect.orElseSucceed(() => Option.none()))
    let cp: HistoryCheckpoint = Option.getOrElse(stored, () => ({
      chainId: target.chainId,
      safe: target.safe,
      version: target.version,
      enabled: true,
      chunkSize: INITIAL_CHUNK.toString(),
      setupFound: false,
      tip: [],
      updatedAt: new Date().toISOString(),
    }))
    if (cp.rpcUrl !== target.rpcUrl)
      cp = { ...cp, rpcUrl: target.rpcUrl, chunkSize: INITIAL_CHUNK.toString() }
    let executions = (yield* storage.getAllWithPrefix(
      'history_events',
      prefix,
      HistoryEvent,
    )).records.filter((r) => isExecution(r.value.name)).length

    const rpc = <A>(f: () => Promise<A>) =>
      Effect.tryPromise({ try: f, catch: (e) => e }).pipe(
        Effect.retry({
          times: 4,
          schedule: Schedule.exponential('1 second'),
          while: (e) => classifyLogError(errorInfo(e)) === 'temporary',
        }),
      )
    const getLogs = (fromBlock: bigint, toBlock: bigint) =>
      rpc(() => client.getLogs({ address: target.safe, fromBlock, toBlock })).pipe(
        Effect.mapError((e) => new LogsFailed(classifyLogError(errorInfo(e)), shortMessage(e))),
      )

    const progress = (status: ScanProgress['status'], reason?: string): ScanProgress => ({
      status,
      ...(reason ? { reason } : {}),
      ...(cp.scannedDownTo !== undefined ? { scannedDownTo: BigInt(cp.scannedDownTo) } : {}),
      ...(cp.finalizedHead !== undefined ? { finalizedHead: BigInt(cp.finalizedHead) } : {}),
      floor: target.floor,
      executions: executions + cp.tip.filter((e) => isExecution(e.name)).length,
      ...(cp.onchainNonce !== undefined ? { onchainNonce: BigInt(cp.onchainNonce) } : {}),
    })
    /** Save events and the checkpoint together, then report. */
    const commit = (events: readonly HistoryEvent[], next: HistoryCheckpoint) =>
      Effect.gen(function* () {
        const stamped = { ...next, updatedAt: new Date().toISOString() }
        yield* storage.putMany([
          ...events.map((e) =>
            write(
              'history_events',
              historyEventKey(target.chainId, target.safe, BigInt(e.blockNumber), e.logIndex),
              HistoryEvent,
              e,
            ),
          ),
          write('history_checkpoints', key, HistoryCheckpoint, stamped),
        ])
        cp = stamped
        executions += events.filter((e) => isExecution(e.name)).length
        hooks.onProgress(progress(stamped.status ?? 'scanning', stamped.reason))
      })
    const finish = (status: 'complete' | 'incomplete' | 'unavailable', reason?: string) =>
      Effect.gen(function* () {
        const { reason: _, ...rest } = cp
        yield* commit([], { ...rest, status, ...(reason ? { reason } : {}) })
        return progress(status, reason)
      })
    const unavailable = (e: LogsFailed) =>
      finish(
        'unavailable',
        e.kind === 'refused'
          ? `Your RPC doesn't serve historical logs (${e.message}).`
          : `Your RPC kept failing: ${e.message}. The scan resumes where it stopped next time.`,
      )

    const heads = yield* Effect.either(
      Effect.all([
        rpc(() => client.latestBlock()),
        rpc(() => client.finalizedBlock()).pipe(Effect.orElseSucceed(() => undefined)),
        rpc(() => client.nonce(target.safe)),
      ]),
    )
    if (heads._tag === 'Left')
      return yield* finish('unavailable', `Your RPC failed: ${shortMessage(heads.left)}`)
    const [latest, finalizedTag, nonce] = heads.right
    const finalized = finalizedTag ?? (latest > FALLBACK_DEPTH ? latest - FALLBACK_DEPTH : 0n)
    cp = { ...cp, onchainNonce: nonce.toString() }

    // 1. Forward: from the stored head up to the new finalized block
    if (cp.finalizedHead !== undefined) {
      let from = BigInt(cp.finalizedHead) + 1n
      while (from <= finalized) {
        if (hooks.cancelled()) return progress('stopped')
        const size = BigInt(cp.chunkSize)
        const to = from + size - 1n < finalized ? from + size - 1n : finalized
        const logs = yield* Effect.either(getLogs(from, to))
        if (logs._tag === 'Left') {
          if (logs.left.kind !== 'range') return yield* unavailable(logs.left)
          const smaller = smallerChunk(size)
          if (smaller === 0n)
            return yield* unavailable(new LogsFailed('refused', logs.left.message))
          cp = { ...cp, chunkSize: smaller.toString() }
          continue
        }
        const events = logs.right.flatMap((l) => toEvent(l, target.version) ?? [])
        yield* commit(events, {
          ...cp,
          finalizedHead: to.toString(),
          chunkSize: largerChunk(size).toString(),
          status: 'scanning',
        })
        from = to + 1n
      }
    } else {
      cp = { ...cp, finalizedHead: finalized.toString() }
    }

    // 2. Backward: from below what's scanned, down to the Safe's creation or the floor
    let cursor = cp.scannedDownTo !== undefined ? BigInt(cp.scannedDownTo) - 1n : finalized
    while (!cp.setupFound && cursor >= target.floor) {
      if (hooks.cancelled()) return progress('stopped')
      const size = BigInt(cp.chunkSize)
      const from = cursor - size + 1n > target.floor ? cursor - size + 1n : target.floor
      const logs = yield* Effect.either(getLogs(from, cursor))
      if (logs._tag === 'Left') {
        if (logs.left.kind !== 'range') return yield* unavailable(logs.left)
        const smaller = smallerChunk(size)
        if (smaller === 0n) return yield* unavailable(new LogsFailed('refused', logs.left.message))
        cp = { ...cp, chunkSize: smaller.toString() }
        continue
      }
      const events = logs.right.flatMap((l) => toEvent(l, target.version) ?? [])
      yield* commit(events, {
        ...cp,
        scannedDownTo: from.toString(),
        chunkSize: largerChunk(size).toString(),
        setupFound: cp.setupFound || events.some((e) => e.name === 'SafeSetup'),
        status: 'scanning',
      })
      cursor = from - 1n
    }

    // 3. The tip window, above the finalized block: re-fetched in full, stored apart
    let tip: HistoryEvent[] = []
    if (latest > finalized) {
      const logs = yield* Effect.either(getLogs(finalized + 1n, latest))
      if (logs._tag === 'Left') return yield* unavailable(logs.left)
      tip = logs.right.flatMap((l) => toEvent(l, target.version) ?? [])
    }
    cp = { ...cp, tip }

    const status = completeness({
      setupFound: cp.setupFound,
      executions: executions + tip.filter((e) => isExecution(e.name)).length,
      onchainNonce: nonce,
      floorReached: cursor < target.floor,
    })
    return yield* finish(status.kind, status.kind === 'complete' ? undefined : status.reason)
  })
