import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import type { CreationPlan } from '@/core/create-safe'
import { run } from '@/effect/run'
import { checkCreation } from '@/features/safes/create-program'
import { loadSafe } from '@/features/safes/load-safe'
import {
  listAddressBook,
  listSafes,
  removeLabel,
  removeSafe,
  saveSafe,
  setLabel,
} from '@/features/safes/store'
import type { AddressBookEntry, SafeRecord } from '@/schemas/safes'
import { keys } from './keys'

/**
 * Chain state: owners, threshold, nonce and authenticity at a fresh pinned block. `fresh`
 * re-reads whenever the view mounts, for screens that make safety decisions (SPEC §8.4).
 */
/** How old a "fresh" read may be. */
export const FRESH_MS = 5_000

export function useSafe(
  chainId: number,
  address: Address | undefined,
  enabled = true,
  fresh = false,
) {
  return useQuery({
    queryKey: keys.safe(chainId, address ?? '0x'),
    queryFn: () => run(loadSafe(chainId, address as Address)),
    enabled: enabled && !!address,
    // `fresh`: re-read on entry unless the last read is under 5 s old (a Safe just loaded by the
    // previous screen is current enough; one from another tab's session isn't)
    staleTime: fresh ? FRESH_MS : 30_000,
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

export function useRemoveLabel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ chainId, address }: { chainId: number | '*'; address: string }) =>
      run(removeLabel(chainId, address)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.addressBook() }),
  })
}

/**
 * SPEC §3.14: the checks before creating a Safe (official contracts by code hash, the predicted
 * address, and the factory's own answer). Re-run on each review, since chain state can change.
 */
export function useCreationCheck(plan: CreationPlan | undefined, from: Address | undefined) {
  return useQuery({
    queryKey: plan
      ? keys.safeCreation(plan.chainId, plan.address, from)
      : ['safe-creation', 'none'],
    queryFn: () => run(checkCreation(plan as CreationPlan, from)),
    enabled: !!plan,
    staleTime: 0,
    retry: false,
  })
}
