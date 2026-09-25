// The setup screen's Test (SPEC §3.1): eth_chainId must match, then probe eth_simulateV1 (§7.5).
import { Effect, Schedule } from 'effect'
import { zeroAddress } from 'viem'
import { classifyMethodError, errorInfo, shortMessage } from '@/core/rpc-errors'
import { type Endpoint, endpointLabel, publicClientFor } from '@/effect/rpc-client'
import { rpcFailure } from '@/effect/rpc-failure'

export type SimulationSupport =
  | { readonly status: 'supported' }
  | { readonly status: 'unsupported'; readonly reason: string }
  | { readonly status: 'temporary'; readonly reason: string }

export interface RpcTestResult {
  readonly chainId: number
  readonly simulation: SimulationSupport
}

// SPEC §8.4: retry each error up to 2 times before showing it (racing upstreams may differ).
const retry = { times: 2, schedule: Schedule.exponential('400 millis') } as const

/** The caller compares `chainId` with the chain it expects, so results can be cached per URL. */
export const testRpc = (endpoint: Endpoint) =>
  Effect.gen(function* () {
    const label = endpointLabel(endpoint)
    const client = publicClientFor(endpoint, 'setup:test')
    const chainId = yield* Effect.tryPromise({
      try: () => client.getChainId(),
      catch: rpcFailure(label),
    }).pipe(Effect.retry({ ...retry, while: (e) => e._tag === 'RpcError' }))
    const simulation = yield* probeSimulation(endpoint)
    return { chainId, simulation } satisfies RpcTestResult
  })

/** A trivial eth_simulateV1 call. Odd errors count as temporary, never as "unsupported". */
export const probeSimulation = (endpoint: Endpoint) =>
  Effect.tryPromise(() =>
    publicClientFor(endpoint, 'setup:simulate-probe').simulateBlocks({
      blocks: [{ calls: [{ to: zeroAddress, data: '0x' }] }],
    }),
  ).pipe(
    Effect.retry({
      ...retry,
      while: (e) => classifyMethodError(errorInfo(e.error)) === 'temporary',
    }),
    Effect.map((): SimulationSupport => ({ status: 'supported' })),
    Effect.catchAll((e) =>
      Effect.succeed<SimulationSupport>({
        status: classifyMethodError(errorInfo(e.error)),
        reason: shortMessage(e.error),
      }),
    ),
  )
