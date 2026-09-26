// Decoding with bundled knowledge only, no chain reads (SPEC §7.1): this chain's Universal Router
// (§3.13), the Safe's own ABI for calls on itself, then the bundled standard ABIs. Used for
// one-line summaries (queue, history, import) and the Verify page.
import type { Address } from 'viem'
import { type Decoded, decodeCalldata } from './decode'
import { knownAbis, safeManagementAbi } from './known-abis'
import type { SafeTx } from './safe-tx'
import { decodeRouterFor } from './uniswap'

export function decodeOffline(
  chainId: number,
  safe: Address,
  tx: Pick<SafeTx, 'to' | 'data' | 'operation'>,
  label: (abiName: string) => string = (name) => name,
): Decoded {
  const router = tx.operation === 0 ? decodeRouterFor(chainId, tx.to, tx.data) : undefined
  if (router) return router
  return decodeCalldata(
    tx.data,
    tx.to.toLowerCase() === safe.toLowerCase()
      ? [{ source: 'Safe', abi: safeManagementAbi }]
      : knownAbis.map((k) => ({ source: label(k.name), abi: k.abi })),
  )
}
