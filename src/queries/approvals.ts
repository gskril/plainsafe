import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type Address, encodeFunctionData, type Hex } from 'viem'
import { useSendTransaction } from 'wagmi'
import { run } from '@/effect/run'
import { approveHashAbi, readApprovals, readApprovalsMany } from '@/features/execute/approvals'
import { waitForReceipt } from '@/features/execute/program'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { useAccountOn } from '@/wallet/use-account-on'
import { keys } from './keys'

export function useApprovals(chainId: number, safe: SafeSnapshot | undefined, safeTxHash: Hex) {
  return useQuery({
    queryKey: keys.approvals(chainId, safe?.address ?? '0x', safeTxHash, safe?.block ?? 0n),
    queryFn: () =>
      run(
        readApprovals(
          chainId,
          safe?.address as Address,
          safe?.owners ?? [],
          safeTxHash,
          safe?.block ?? 0n,
        ),
      ),
    enabled: !!safe?.owners && safe.authenticity.status === 'verified',
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * Onchain approvals for the queue's pending rows, in one multicall at the Safe's pinned block, so
 * rows count them like the review screen does (SPEC §3.9, §5.2). Keys are lowercase safeTxHashes.
 */
export function useQueueApprovals(safe: SafeSnapshot | undefined, safeTxHashes: readonly Hex[]) {
  return useQuery({
    queryKey: keys.queueApprovals(
      safe?.chainId ?? 0,
      safe?.address ?? '0x',
      safeTxHashes,
      safe?.block ?? 0n,
    ),
    queryFn: () =>
      run(
        readApprovalsMany(
          safe?.chainId ?? 0,
          safe?.address as Address,
          safe?.owners ?? [],
          safeTxHashes,
          safe?.block ?? 0n,
        ),
      ),
    enabled: !!safe?.owners && safe.authenticity.status === 'verified' && safeTxHashes.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    // A new block or a new row changes the key: keep the last counts until the new read lands,
    // rather than briefly dropping every onchain approval (lookups are by safeTxHash)
    placeholderData: keepPreviousData,
  })
}

/** An owner records their approval onchain: a transaction from their wallet to the Safe. */
export function useApproveHash() {
  const accountOn = useAccountOn()
  const send = useSendTransaction()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: { chainId: number; safe: Address; safeTxHash: Hex }) => {
      await accountOn(args.chainId)
      const hash = await send.mutateAsync({
        to: args.safe,
        data: encodeFunctionData({
          abi: approveHashAbi,
          functionName: 'approveHash',
          args: [args.safeTxHash],
        }),
        chainId: args.chainId,
      })
      const receipt = await run(waitForReceipt(args.chainId, hash))
      if (receipt.status === 'reverted')
        throw new Error(`The approval transaction ${hash} reverted.`)
      return hash
    },
    // Re-read the Safe at a new block, and the approvals with it
    onSuccess: (_, args) =>
      queryClient.invalidateQueries({ queryKey: keys.safe(args.chainId, args.safe) }),
  })
}
