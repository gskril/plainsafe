import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import { run } from '@/effect/run'
import { loadSafe } from '@/features/safes/load-safe'
import { listAddressBook, listSafes, removeSafe, saveSafe, setLabel } from '@/features/safes/store'
import type { AddressBookEntry, SafeRecord } from '@/schemas/safes'
import { keys } from './keys'

/** Chain state: owners, threshold, nonce and authenticity at a fresh pinned block. */
export function useSafe(chainId: number, address: Address | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.safe(chainId, address ?? '0x'),
    queryFn: () => run(loadSafe(chainId, address as Address)),
    enabled: enabled && !!address,
    staleTime: 30_000,
  })
}

export function useSafeList(store: 'safes' | 'recent') {
  return useQuery({
    queryKey: store === 'safes' ? keys.mySafes() : keys.recent(),
    queryFn: () => run(listSafes(store)),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useSaveSafe(store: 'safes' | 'recent') {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (record: SafeRecord) => run(saveSafe(store, record)),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: store === 'safes' ? keys.mySafes() : keys.recent(),
      }),
  })
}

export function useRemoveSafe(store: 'safes' | 'recent') {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ chainId, address }: { chainId: number; address: string }) =>
      run(removeSafe(store, chainId, address)),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: store === 'safes' ? keys.mySafes() : keys.recent(),
      }),
  })
}

export function useAddressBook() {
  return useQuery({
    queryKey: keys.addressBook(),
    queryFn: () => run(listAddressBook),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useSetLabels() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (entries: readonly AddressBookEntry[]) => {
      for (const e of entries) await run(setLabel(e))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.addressBook() }),
  })
}
