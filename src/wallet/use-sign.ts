// Signing with eth_signTypedData_v4 through wagmi (SPEC §3.5). The chain is switched (or added)
// first, because wallets reject typed data whose domain.chainId differs from the active chain.
import { useMutation } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useConnection, useSignTypedData, useSwitchChain } from 'wagmi'
import { type SafeTx, safeTxHashes, safeTxTypedData } from '@/core/safe-tx'
import { normalizeV, recoverSigner } from '@/core/signatures'
import type { PackageSignature } from '@/schemas/package'

export function useSignSafeTx() {
  const connection = useConnection()
  const switchChain = useSwitchChain()
  const signTypedData = useSignTypedData()
  return useMutation({
    mutationFn: async ({
      chainId,
      safe,
      tx,
    }: {
      chainId: number
      safe: Address
      tx: SafeTx
    }): Promise<PackageSignature> => {
      if (connection.status !== 'connected') throw new Error('Connect your wallet first.')
      const account = connection.address
      if (connection.chainId !== chainId) await switchChain.mutateAsync({ chainId })
      const typed = safeTxTypedData(chainId, safe, tx)
      const raw = await signTypedData.mutateAsync({ ...typed, account })
      const data = normalizeV(raw)
      // Check the signature by recovering it before it's stored (SPEC §3.5).
      const signer = await recoverSigner(safeTxHashes(chainId, safe, tx).safeTx, data)
      if (signer?.toLowerCase() !== account.toLowerCase()) {
        throw new Error(
          `The wallet returned a signature that doesn't recover to ${account}. It was not stored.`,
        )
      }
      return { signer: account, kind: 'eip712', data }
    },
  })
}
