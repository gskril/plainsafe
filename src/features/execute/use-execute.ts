import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Address, Hex } from 'viem'
import { useConnection, useSendTransaction, useSwitchChain } from 'wagmi'
import { execTransactionData, executionOutcome } from '@/core/execution'
import type { SafeTx } from '@/core/safe-tx'
import { run } from '@/effect/run'
import { setExecution } from '@/features/queue/store'
import { keys } from '@/queries/keys'
import { estimateExecution, waitForReceipt } from './program'

export type ExecStep = 'idle' | 'estimating' | 'wallet' | 'pending' | 'done'

export function useExecute() {
  const connection = useConnection()
  const switchChain = useSwitchChain()
  const send = useSendTransaction()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<ExecStep>('idle')
  const [txHash, setTxHash] = useState<Hex>()

  const mutation = useMutation({
    mutationFn: async (args: {
      chainId: number
      safe: Address
      tx: SafeTx
      safeTxHash: Hex
      signatures: Hex
    }) => {
      if (connection.status !== 'connected') throw new Error('Connect a wallet to execute.')
      const from = connection.address
      if (connection.chainId !== args.chainId)
        await switchChain.mutateAsync({ chainId: args.chainId })
      const data = execTransactionData(args.tx, args.signatures)
      setStep('estimating')
      const gas = await run(estimateExecution(args.chainId, args.safe, from, data))
      setStep('wallet')
      const hash = await send.mutateAsync({
        to: args.safe,
        data,
        gas: (gas * 12n) / 10n,
        chainId: args.chainId,
      })
      setTxHash(hash)
      setStep('pending')
      const receipt = await run(waitForReceipt(args.chainId, hash))
      if (receipt.status === 'reverted')
        throw new Error(`The transaction ${hash} reverted on-chain. Nothing was executed.`)
      const outcome = executionOutcome(receipt.logs, args.safe, args.safeTxHash)
      if (!outcome)
        throw new Error(
          `Transaction ${hash} succeeded, but it didn't execute this Safe transaction.`,
        )
      await run(
        setExecution(args.chainId, args.safe, args.safeTxHash, {
          status: outcome,
          txHash: hash,
          at: new Date().toISOString(),
        }),
      )
      setStep('done')
      return { hash, outcome }
    },
    onError: () => setStep('idle'),
    onSettled: (_, __, args) => {
      void queryClient.invalidateQueries({
        queryKey: keys.packages(args.chainId, args.safe).slice(0, 3),
      })
      void queryClient.invalidateQueries({ queryKey: keys.safe(args.chainId, args.safe) })
    },
  })
  return { ...mutation, step, txHash }
}
