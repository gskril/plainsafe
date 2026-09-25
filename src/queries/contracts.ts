import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address, Hex } from 'viem'
import { run } from '@/effect/run'
import { inspectContract } from '@/features/abi/inspect'
import { getSavedAbi, saveAbi } from '@/features/abi/library'
import { tokenMeta } from '@/features/tokens/token-meta'
import type { AbiRecord } from '@/schemas/abi'
import { keys } from './keys'

export function useInspect(chainId: number, address: Address | undefined) {
  return useQuery({
    queryKey: keys.whatsabi(chainId, address ?? '0x'),
    queryFn: () => run(inspectContract(chainId, address as Address)),
    enabled: !!address,
    staleTime: 60_000,
  })
}

export function useTokenMeta(chainId: number, token: Address | undefined) {
  return useQuery({
    queryKey: keys.tokenMeta(chainId, token ?? '0x'),
    queryFn: () => run(tokenMeta(chainId, token as Address)),
    enabled: !!token,
    staleTime: 5 * 60_000,
  })
}

export function useSavedAbi(chainId: number, codeHash: Hex | undefined) {
  return useQuery({
    queryKey: keys.savedAbi(chainId, codeHash ?? '0x'),
    queryFn: async () => (await run(getSavedAbi(chainId, codeHash as Hex))) ?? null,
    enabled: !!codeHash,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useSaveAbi() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (record: AbiRecord) => run(saveAbi(record)),
    onSuccess: (_, r) =>
      queryClient.invalidateQueries({ queryKey: keys.savedAbi(r.chainId, r.codeHash) }),
  })
}
