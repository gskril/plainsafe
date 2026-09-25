import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address, Hex } from 'viem'
import { run } from '@/effect/run'
import { type ContractInspection, inspectContract } from '@/features/abi/inspect'
import { getSavedAbi, saveAbi } from '@/features/abi/library'
import { fetchSourcifyAbi, lookupSignatures } from '@/features/abi/remote'
import { tokenMeta } from '@/features/tokens/token-meta'
import type { AbiRecord } from '@/schemas/abi'
import { keys } from './keys'
import { useLoadedSettings } from './settings'

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

/** The implementation's verified ABI from Sourcify, only with the capability on (SPEC §7.3). */
export function useSourcifyAbi(chainId: number, inspection: ContractInspection | undefined) {
  const on = useLoadedSettings().capabilities.sourcify
  const hash = inspection?.implementationCodeHash
  return useQuery({
    queryKey: keys.sourcify(chainId, hash ?? '0x'),
    queryFn: () => fetchSourcifyAbi(chainId, inspection?.implementation as Address),
    enabled: on && !!inspection?.hasCode && !inspection.delegatedTo && !!hash,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Signature-database entries for a selector, only with the capability on (SPEC §7.1 level 4). */
export function useSignatureLookup(selector: Hex | undefined) {
  const on = useLoadedSettings().capabilities.signatureDatabase
  return useQuery({
    queryKey: keys.signatures(selector ?? '0x'),
    queryFn: () => lookupSignatures(selector as Hex),
    enabled: on && !!selector,
    staleTime: Number.POSITIVE_INFINITY,
  })
}
