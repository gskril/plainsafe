import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { Address } from 'viem'
import { keccak256, toHex } from 'viem'
import { run } from '@/effect/run'
import { aggregatorDeployed, ethFiatRate, loadBalances } from '@/features/balances/program'
import {
  addMyToken,
  deleteTokenList,
  listMyTokens,
  listTokenLists,
  removeMyToken,
  saveTokenList,
  setListEnabled,
  tokenUniverse,
} from '@/features/tokens/store'
import type { MyToken, TokenListRecord } from '@/schemas/tokenlist'
import { keys } from './keys'
import { useLoadedSettings } from './settings'

export function useTokenLists() {
  return useQuery({
    queryKey: keys.tokenLists(),
    queryFn: () => run(listTokenLists),
    staleTime: Number.POSITIVE_INFINITY,
  })
}
export function useMyTokens() {
  return useQuery({
    queryKey: keys.myTokens(),
    queryFn: () => run(listMyTokens),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Known tokens on a chain, from My tokens and enabled lists. */
export function useTokenUniverse(chainId: number) {
  const lists = useTokenLists()
  const mine = useMyTokens()
  const tokens = useMemo(
    () =>
      lists.data && mine.data
        ? tokenUniverse(chainId, lists.data.lists, mine.data.tokens)
        : undefined,
    [chainId, lists.data, mine.data],
  )
  return tokens
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: keys.tokenLists() })
    void queryClient.invalidateQueries({ queryKey: keys.myTokens() })
    void queryClient.invalidateQueries({ queryKey: ['balances'] })
  }
}

export function useTokenMutations() {
  const invalidate = useInvalidate()
  const opts = { onSuccess: invalidate }
  return {
    saveList: useMutation({ mutationFn: (r: TokenListRecord) => run(saveTokenList(r)), ...opts }),
    setEnabled: useMutation({
      mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
        run(setListEnabled(id, enabled)),
      ...opts,
    }),
    deleteList: useMutation({ mutationFn: (id: string) => run(deleteTokenList(id)), ...opts }),
    addMine: useMutation({ mutationFn: (t: MyToken) => run(addMyToken(t)), ...opts }),
    removeMine: useMutation({
      mutationFn: ({ chainId, address }: { chainId: number; address: Address }) =>
        run(removeMyToken(chainId, address)),
      ...opts,
    }),
  }
}

export function useBalances(chainId: number, safe: Address) {
  const tokens = useTokenUniverse(chainId)
  const aggregator = useQuery({
    queryKey: keys.aggregator(chainId),
    queryFn: () => run(aggregatorDeployed(chainId)),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const tokenSetHash = tokens
    ? keccak256(
        toHex(
          tokens
            .map((t) => t.address.toLowerCase())
            .sort()
            .join(','),
        ),
      )
    : '0x'
  return useQuery({
    queryKey: [...keys.balances(chainId, safe, tokenSetHash), aggregator.data === true],
    queryFn: () => run(loadBalances(chainId, safe, tokens ?? [], aggregator.data === true)),
    enabled: !!tokens && aggregator.isFetched,
    staleTime: 30_000,
  })
}

/** Fiat per ETH, when the currency is fiat and Mainnet is set up (SPEC §10.1). */
export function useEthFiat() {
  const settings = useLoadedSettings()
  const currency = settings.currency
  const hasMainnet = settings.chains.some((c) => c.id === 1)
  return useQuery({
    queryKey: keys.ethFiat(currency),
    queryFn: () => run(ethFiatRate(currency as 'USD' | 'EUR')),
    enabled: currency !== 'ETH' && hasMainnet,
    staleTime: 60_000,
  })
}
