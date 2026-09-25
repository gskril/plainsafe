// The Rpc service (SPEC §9.2): a viem PublicClient per chain, built from settings.
import { Context, Effect, Layer, Schedule } from 'effect'
import { createPublicClient, custom, type EIP1193Provider, http, type PublicClient } from 'viem'
import { toViemChain } from '@/chains'
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
            // One HTTP request per tick for everything a view asks for (SPEC §8.4 rate limits)
            transport: http(c.rpc.url, {
              fetchFn: netguard.fetchFor(tag),
              batch: { wait: 10 },
              retryCount: 0,
              timeout: 20_000,
            }),
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
        client = createPublicClient({ chain, transport: custom(w.provider, { retryCount: 0 }) })
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
