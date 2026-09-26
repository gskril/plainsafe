// The Rpc service (SPEC §9.2): a viem PublicClient per chain, built from settings.
import { Context, Effect, Layer, Schedule } from 'effect'
import {
  createPublicClient,
  custom,
  type EIP1193Provider,
  http,
  type PublicClient,
  type Transport,
} from 'viem'
import { toViemChain } from '@/chains'
import { ccipRequest } from '@/features/ens/ccip'
import { netguard } from '@/netguard'
import type { ChainSettings } from '@/schemas/settings'
import { type BlockedByNetguard, RpcError, WrongChain } from './errors'
import { rpcFailure } from './rpc-failure'

export interface WalletState {
  readonly provider: EIP1193Provider
  readonly chainId: number
}

// Updated by the app when settings or the wallet connection change (see settings-sync.ts).
let chains: readonly ChainSettings[] = []
let wallet: WalletState | undefined
const cache = new Map<string, PublicClient>()

export const setRpcChains = (next: readonly ChainSettings[]) => {
  chains = next
  cache.clear()
}
export const setWallet = (next: WalletState | undefined) => {
  wallet = next
  for (const key of [...cache.keys()]) if (key.includes('|wallet|')) cache.delete(key)
}

/**
 * viem batches by RPC URL across every client (one queue per URL), and sends each batch with the
 * fetch of whichever client queued first. So each client records its tag here when it queues a
 * call, and the batch is logged with every tag in it (SPEC §8.1), e.g. "ens+safe+swap".
 */
const queuedTags = new Map<string, Set<string>>()

function takeTags(url: string): string {
  const tags = queuedTags.get(url)
  queuedTags.delete(url)
  return tags?.size ? [...tags].sort().join('+') : 'untagged'
}

function taggedHttp(url: string, tag: string): Transport {
  const inner = http(url, {
    fetchFn: (input, init) => netguard.fetchFor(takeTags(url))(input, init),
    batch: { wait: 10 },
    retryCount: 0,
    timeout: 20_000,
  })
  return (opts) => {
    const t = inner(opts)
    return {
      ...t,
      request: ((args, options) => {
        const tags = queuedTags.get(url) ?? new Set<string>()
        tags.add(tag)
        queuedTags.set(url, tags)
        return t.request(args, options)
      }) as typeof t.request,
    }
  }
}

export interface RpcApi {
  readonly chain: (chainId: number) => Effect.Effect<ChainSettings, RpcError>
  /** A client for the chain; `tag` names the caller in the network log (SPEC §8.1). */
  readonly client: (
    chainId: number,
    tag: string,
  ) => Effect.Effect<PublicClient, RpcError | WrongChain>
}

export class Rpc extends Context.Tag('Rpc')<Rpc, RpcApi>() {}

export const endpointOf = (c: ChainSettings) =>
  c.rpc._tag === 'url' ? c.rpc.url : "your wallet's RPC"

const chainOf = (chainId: number) =>
  Effect.suspend(() => {
    const c = chains.find((x) => x.id === chainId)
    return c
      ? Effect.succeed(c)
      : Effect.fail(
          new RpcError({
            endpoint: `chain ${chainId}`,
            message: `No RPC is set up for chain ${chainId}.`,
          }),
        )
  })

export const RpcLive = Layer.succeed(Rpc, {
  chain: chainOf,
  client: (chainId, tag) =>
    Effect.flatMap(chainOf(chainId), (c): Effect.Effect<PublicClient, RpcError | WrongChain> => {
      const chain = toViemChain(c)
      if (c.rpc._tag === 'url') {
        const key = `${chainId}|url|${c.rpc.url}|${tag}`
        let client = cache.get(key)
        if (!client) {
          client = createPublicClient({
            chain,
            ccipRead: { request: ccipRequest },
            // One HTTP request per tick for everything the app asks for (SPEC §8.4 rate limits)
            transport: taggedHttp(c.rpc.url, tag),
          })
          cache.set(key, client)
        }
        return Effect.succeed(client)
      }
      const w = wallet
      if (!w) {
        return Effect.fail(
          new RpcError({
            endpoint: endpointOf(c),
            message: `Connect your wallet to read from ${c.name}.`,
          }),
        )
      }
      if (w.chainId !== chainId) {
        return Effect.fail(
          new WrongChain({ endpoint: endpointOf(c), expected: chainId, actual: w.chainId }),
        )
      }
      const key = `${chainId}|wallet|${tag}`
      let client = cache.get(key)
      if (!client) {
        client = createPublicClient({
          chain,
          ccipRead: { request: ccipRequest },
          transport: custom(w.provider, { retryCount: 0 }),
        })
        cache.set(key, client)
      }
      return Effect.succeed(client)
    }),
})

/**
 * Run one RPC call: failures become tagged errors, and RPC errors are retried up to 2 times
 * before they're shown, since racing upstreams may answer differently (SPEC §8.4).
 */
export const rpcCall = <A>(
  endpoint: string,
  f: () => Promise<A>,
): Effect.Effect<A, RpcError | BlockedByNetguard> =>
  Effect.tryPromise({ try: f, catch: rpcFailure(endpoint) }).pipe(
    Effect.retry({
      times: 2,
      schedule: Schedule.exponential('400 millis'),
      while: (e) => e._tag === 'RpcError',
    }),
  )

// Highest block seen per chain this session, to catch stale upstreams behind racing RPCs.
const highestBlock = new Map<number, bigint>()

/**
 * Pin the block for a view (SPEC §8.4): the latest block, sanity-checked. Racing or
 * load-balanced RPCs can answer from a dead or lagging upstream (block 0, or far behind what we
 * already saw); that answer is treated as an RPC error, so it's retried rather than read from.
 */
export const pinBlock = (chainId: number, client: PublicClient, endpoint: string) =>
  rpcCall(endpoint, async () => {
    const n = await client.getBlockNumber({ cacheTime: 0 })
    const seen = highestBlock.get(chainId) ?? 0n
    if (n === 0n || n + 100n < seen) {
      throw new Error(
        `the RPC answered with block ${n}, behind block ${seen} seen earlier (a stale upstream)`,
      )
    }
    if (n > seen) highestBlock.set(chainId, n)
    return n
  })
