import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { type Hex, isAddressEqual } from 'viem'
import { useConnection, useSendTransaction, useSwitchChain } from 'wagmi'
import { type CreationPlan, createdSafe } from '@/core/create-safe'
import { run } from '@/effect/run'
import { waitForReceipt } from '@/features/execute/program'
import { keys } from '@/queries/keys'
import { checkCreation, loadCreatedSafe } from './create-program'
import { safeRecord, saveSafe, setLabel } from './store'

export type CreateStep = 'idle' | 'checking' | 'wallet' | 'pending' | 'verifying' | 'done'

/** Create a Safe (SPEC §3.14): check, send from the wallet, then verify it like any added Safe. */
export function useCreateSafe() {
  const connection = useConnection()
  const switchChain = useSwitchChain()
  const send = useSendTransaction()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<CreateStep>('idle')
  const [txHash, setTxHash] = useState<Hex>()

  const mutation = useMutation({
    mutationFn: async ({ plan, name }: { plan: CreationPlan; name?: string }) => {
      if (connection.status !== 'connected') throw new Error('Connect a wallet to create the Safe.')
      if (connection.chainId !== plan.chainId)
        await switchChain.mutateAsync({ chainId: plan.chainId })
      // Checked again right before sending, from the account that will send
      setStep('checking')
      const { gas } = await run(checkCreation(plan, connection.address))
      setStep('wallet')
      const hash = await send.mutateAsync({
        to: plan.to,
        data: plan.data,
        chainId: plan.chainId,
        ...(gas ? { gas: (gas * 12n) / 10n } : {}),
      })
      setTxHash(hash)
      setStep('pending')
      const receipt = await run(waitForReceipt(plan.chainId, hash, 'create'))
      if (receipt.status === 'reverted')
        throw new Error(`The transaction ${hash} reverted on-chain. No Safe was created.`)
      const created = createdSafe(receipt.logs, plan.to)
      if (!created || !isAddressEqual(created, plan.address))
        throw new Error(`Transaction ${hash} didn't create the Safe at ${plan.address}.`)

      setStep('verifying')
      const safe = await run(loadCreatedSafe(plan.chainId, plan.address))
      queryClient.setQueryData(keys.safe(plan.chainId, plan.address), safe)
      const record = safeRecord(safe)
      if (!record)
        throw new Error(
          `The Safe at ${plan.address} was created, but it didn't pass the authenticity check (${safe.authenticity.status}).`,
        )
      await run(saveSafe('safes', record))
      const label = name?.trim()
      if (label) await run(setLabel({ chainId: plan.chainId, address: plan.address, label }))
      setStep('done')
      return safe
    },
    onError: () => setStep('idle'),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.mySafes() })
      void queryClient.invalidateQueries({ queryKey: keys.addressBook() })
    },
  })
  return { ...mutation, step, txHash }
}
