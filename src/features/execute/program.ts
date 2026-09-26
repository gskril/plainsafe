// Gas estimation and receipts over our RPC (SPEC §3.8). The wallet only signs and sends.
import { Data, Effect } from 'effect'
import type { Abi, Address, Hex } from 'viem'
import { revertData, translateRevert } from '@/core/execution'
import { knownAbis } from '@/core/known-abis'
import { RpcError } from '@/effect/errors'
import { endpointOf, Rpc, rpcCall } from '@/effect/rpc'
import { rpcFailure } from '@/effect/rpc-failure'

export class ExecutionWouldFail extends Data.TaggedError('ExecutionWouldFail')<{
  readonly message: string
}> {}

const standardErrors = knownAbis.flatMap((k) => (k.abi as Abi).filter((i) => i.type === 'error'))

/** eth_estimateGas on the real execTransaction; a revert is translated, not retried. */
export const estimateExecution = (chainId: number, safe: Address, from: Address, data: Hex) =>
  Effect.gen(function* () {
    const rpc = yield* Rpc
    const client = yield* rpc.client(chainId, 'execute')
    const endpoint = endpointOf(yield* rpc.chain(chainId))
    return yield* Effect.tryPromise({
      try: () => client.estimateGas({ account: from, to: safe, data }),
      catch: (e) => {
        const d = revertData(e)
        const text = String((e as Error)?.message ?? '')
        if (d || /revert/i.test(text))
          return new ExecutionWouldFail({ message: translateRevert(d, standardErrors) })
        return rpcFailure(endpoint)(e)
      },
    })
  })

/** `tag` names the caller in the network log: an execution, or creating a Safe (§3.14). */
export const waitForReceipt = (chainId: number, hash: Hex, tag = 'execute') =>
  Effect.gen(function* () {
    const rpc = yield* Rpc
    const client = yield* rpc.client(chainId, tag)
    const endpoint = endpointOf(yield* rpc.chain(chainId))
    const receipt = yield* rpcCall(endpoint, () =>
      client.waitForTransactionReceipt({ hash, pollingInterval: 3_000, timeout: 10 * 60_000 }),
    )
    if (!receipt) return yield* new RpcError({ endpoint, message: 'No receipt' })
    return receipt
  })
