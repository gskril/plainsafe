// Symbols and decimals for swap amounts: ETH, then your token lists, then the chain's Uniswap
// WETH and USDC from the bundled table, then (unless offline) the token contract over RPC.
import type { Address } from 'viem'
import { isEth, UNISWAP } from '@/core/uniswap'
import { useTokenMeta } from '@/queries/contracts'
import { useTokenUniverse } from '@/queries/tokens'

export interface Coin {
  readonly symbol: string
  readonly decimals: number
}

export function useCoin(chainId: number, address: Address, offline = false): Coin | undefined {
  const universe = useTokenUniverse(chainId)
  const same = (a: string) => a.toLowerCase() === address.toLowerCase()
  const bundled = UNISWAP[chainId]
  const listed = isEth(address)
    ? { symbol: 'ETH', decimals: 18 }
    : (universe?.find((t) => same(t.address)) ??
      (bundled && same(bundled.weth)
        ? { symbol: 'WETH', decimals: 18 }
        : bundled && same(bundled.usdc)
          ? { symbol: 'USDC', decimals: 6 }
          : undefined))
  const meta = useTokenMeta(chainId, listed || !universe || offline ? undefined : address)
  return listed ?? meta.data
}
