import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import type { Address } from 'viem'
import { run } from '@/effect/run'
import { historyStore } from '@/features/history/manager'
import { getCheckpoint, listHistoryEvents } from '@/features/history/store'
import { historyKey } from '@/schemas/history'
import { keys } from './keys'

const historyQueryKey = keys.history

export function useHistoryState(chainId: number, safe: Address) {
  const all = useSyncExternalStore(historyStore.subscribe, historyStore.getSnapshot)
  return all.get(historyKey(chainId, safe))
}

/** The stored checkpoint and events, re-read as the worker commits chunks. */
export function useStoredHistory(chainId: number, safe: Address) {
  const queryClient = useQueryClient()
  const state = useHistoryState(chainId, safe)
  const checkpoint = useQuery({
    queryKey: [...historyQueryKey(chainId, safe), 'checkpoint'],
    queryFn: () => run(getCheckpoint(chainId, safe)).then((c) => c ?? null),
  })
  const events = useQuery({
    queryKey: [...historyQueryKey(chainId, safe), 'events'],
    queryFn: () => run(listHistoryEvents(chainId, safe)),
    enabled: !!checkpoint.data?.enabled,
  })
  const progress = state?.progress
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read whenever progress changes
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: historyQueryKey(chainId, safe) })
  }, [progress, queryClient, chainId, safe])
  return { checkpoint, events, state }
}

export const invalidateHistory = (
  queryClient: ReturnType<typeof useQueryClient>,
  chainId: number,
  safe: Address,
) => queryClient.invalidateQueries({ queryKey: historyQueryKey(chainId, safe) })
