import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type Address, encodeFunctionData, type Hex } from 'viem'
import { useConnection, useSendTransaction, useSwitchChain } from 'wagmi'
import { run } from '@/effect/run'
import { approveHashAbi, readApprovals } from '@/features/execute/approvals'
import { waitForReceipt } from '@/features/execute/program'
import type { SafeSnapshot } from '@/features/safes/load-safe'
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

/** An owner records their approval onchain: a transaction from their wallet to the Safe. */
export function useApproveHash() {
  const connection = useConnection()
  const switchChain = useSwitchChain()
  const send = useSendTransaction()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: { chainId: number; safe: Address; safeTxHash: Hex }) => {
      if (connection.status !== 'connected') throw new Error('Connect a wallet first.')
      if (connection.chainId !== args.chainId)
        await switchChain.mutateAsync({ chainId: args.chainId })
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
