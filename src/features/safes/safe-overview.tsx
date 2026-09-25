// #/safe/:chainId/:address (SPEC §9.4): identity, authenticity, owners, threshold, nonce, balance.
import { History, ListChecks, Plus, RefreshCw } from 'lucide-react'
import { type Address, getAddress, isAddress } from 'viem'
import { Link, useParams } from 'wouter'
import { AddressView } from '@/components/address'
import { NotFound } from '@/components/layout/not-found'
import { Button } from '@/components/ui/button'
import { BalancesSection } from '@/features/balances/balances-section'
import { describeError } from '@/lib/errors'
import { useRemoveSafe, useSafe, useSafeList } from '@/queries/safes'
import { useLoadedSettings } from '@/queries/settings'
import { SafeFacts } from './safe-summary'

/** Route params → a configured chain and a valid address, or undefined. */
export function useSafeParams(): { chainId: number; address: Address } | undefined {
  const params = useParams<{ chainId: string; address: string }>()
  const settings = useLoadedSettings()
  const chainId = Number(params.chainId)
  if (!settings.chains.some((c) => c.id === chainId)) return undefined
  if (!isAddress(params.address ?? '', { strict: false })) return undefined
  return { chainId, address: getAddress(params.address as string) }
}

export function SafeOverview() {
  const target = useSafeParams()
  if (!target) return <NotFound />
  return <Overview chainId={target.chainId} address={target.address} />
}

function Overview({ chainId, address }: { chainId: number; address: Address }) {
  const safe = useSafe(chainId, address)
  const mySafes = useSafeList('safes')
  const remove = useRemoveSafe('safes')
  const saved = mySafes.data?.safes.some(
    (s) => s.chainId === chainId && s.address.toLowerCase() === address.toLowerCase(),
  )
  const verified = safe.data?.authenticity.status === 'verified'
  const base = `/safe/${chainId}/${address}`

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Safe</h1>
        <AddressView chainId={chainId} address={address} full />
      </div>

      {safe.isPending && <p className="text-muted-foreground">Reading the Safe…</p>}
      {safe.error && (
        <div className="flex flex-col gap-2">
          <p className="text-destructive">{describeError(safe.error)}</p>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void safe.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
      {safe.data && (
        <>
          <SafeFacts safe={safe.data} />
          <BalancesSection chainId={chainId} safe={address} />
          <div className="flex flex-wrap gap-2">
            <Button asChild disabled={!verified}>
              <Link href={verified ? `${base}/new` : base}>
                <Plus /> New transaction
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`${base}/queue`}>
                <ListChecks /> Queue
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`${base}/history`}>
                <History /> History
              </Link>
            </Button>
            <Button variant="ghost" onClick={() => void safe.refetch()} disabled={safe.isFetching}>
              <RefreshCw className={safe.isFetching ? 'animate-spin' : ''} /> Refresh
            </Button>
          </div>
          {!saved && verified && (
            <p className="text-sm text-muted-foreground">
              Not in My Safes.{' '}
              <Link href="/add" className="underline underline-offset-4">
                Add it
              </Link>{' '}
              to keep it on the home screen.
            </p>
          )}
          {saved && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start text-muted-foreground"
              onClick={() => remove.mutate({ chainId, address })}
            >
              Remove from My Safes
            </Button>
          )}
        </>
      )}
    </div>
  )
}
