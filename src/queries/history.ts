import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import type { Address, Hex } from 'viem'
import { executedSigners } from '@/core/signatures'
import { run } from '@/effect/run'
import { historyStore } from '@/features/history/manager'
import { executingTransaction } from '@/features/history/recover'
import { getCheckpoint, listHistoryEvents } from '@/features/history/store'
import { type HistoryEvent, historyKey } from '@/schemas/history'
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

/** The transaction that emitted an execution's event: its calldata, target and sender. */
export function useExecutingTransaction(chainId: number, event: HistoryEvent, enabled: boolean) {
  return useQuery({
    queryKey: keys.historyTx(chainId, event.transactionHash),
    queryFn: () =>
      run(
        executingTransaction(
          chainId,
          event.transactionHash,
          BigInt(event.blockNumber),
          event.transactionIndex,
        ),
      ),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Who signed an execution, recovered from the signatures it carried. */
export function useExecutedSigners(safeTxHash: Hex, signatures: Hex | undefined) {
  return useQuery({
    queryKey: keys.executedSigners(safeTxHash, signatures ?? '0x'),
    queryFn: () => executedSigners(signatures as Hex, safeTxHash),
    enabled: !!signatures,
    staleTime: Number.POSITIVE_INFINITY,
  })
}
