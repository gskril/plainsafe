// Safe Transaction Service hooks (SPEC §3.15). Only used while the capability is on, or for one
// request the user asked for ("Check once", "Fetch once"), which is allowed for just that request.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import type { VerifiedPackage } from '@/core/package'
import { hasTxService, type SafeWalletLink, TX_SERVICE_ORIGIN } from '@/core/tx-service'
import { run } from '@/effect/run'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { withGrant } from '@/features/settings/policy-sync'
import {
  packageFromSafeWalletLink,
  postToService,
  pullFromService,
} from '@/features/tx-service/program'
import { keys } from './keys'
import { useLoadedSettings } from './settings'

/** Allow api.safe.global just for a call the user explicitly asked for, unless it's on anyway. */
const once = <A>(allowed: boolean, f: () => Promise<A>): Promise<A> =>
  allowed ? f() : withGrant(TX_SERVICE_ORIGIN, f)

export const useTxServiceOn = () => useLoadedSettings().capabilities.safeTransactionService

const pullable = (s: SafeSnapshot | undefined): s is SafeSnapshot =>
  !!s &&
  s.authenticity.status === 'verified' &&
  s.nonce !== undefined &&
  !!s.owners &&
  hasTxService(s.chainId)

const pullKey = (s: SafeSnapshot | undefined) =>
  keys.txService(s?.chainId ?? 0, s?.address ?? '0x', s?.nonce ?? 0n)

/**
 * The Safe's pending transactions on the service: those an owner signed are saved to the queue,
 * the rest are returned for the queue to show (SPEC §3.15). Fetched automatically while the
 * capability is on; with it off, the cache holds whatever "Check once" last found.
 */
export function useTxServicePull(snapshot: SafeSnapshot | undefined) {
  const on = useTxServiceOn()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: pullKey(snapshot),
    queryFn: async () => {
      const s = snapshot as SafeSnapshot
      const result = await run(pullFromService(s))
      await queryClient.invalidateQueries({ queryKey: keys.packages(s.chainId, s.address) })
      return result
    },
    enabled: on && pullable(snapshot),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

/** "Check once": one pull with the capability off, stored where useTxServicePull reads it. */
export function useTxServiceCheckOnce() {
  const on = useTxServiceOn()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (snapshot: SafeSnapshot) => once(on, () => run(pullFromService(snapshot))),
    onSuccess: (result, s) => {
      queryClient.setQueryData(pullKey(s), result)
      return queryClient.invalidateQueries({ queryKey: keys.packages(s.chainId, s.address) })
    },
  })
}

export function usePostToTxService() {
  const on = useTxServiceOn()
  return useMutation({
    mutationFn: (args: {
      v: VerifiedPackage
      owners: readonly Address[]
      preferredProposer?: Address | undefined
    }) => once(on, () => run(postToService(args.v, args.owners, args.preferredProposer))),
  })
}

export function useOpenSafeWalletLink() {
  const on = useTxServiceOn()
  return useMutation({
    mutationFn: (link: SafeWalletLink) => once(on, () => run(packageFromSafeWalletLink(link))),
  })
}
