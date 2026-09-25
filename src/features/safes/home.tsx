import { Import, Plus, ShieldCheck } from 'lucide-react'
import { Link } from 'wouter'
import { Button } from '@/components/ui/button'
import { shortAddress } from '@/lib/format'
import { useAddressBook, useSafeList } from '@/queries/safes'
import { useLoadedSettings } from '@/queries/settings'
import type { SafeRecord } from '@/schemas/safes'
import { labelFor } from './store'

export function Home() {
  const mySafes = useSafeList('safes')
  const recent = useSafeList('recent')
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My Safes</h1>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" asChild>
            <Link href="/verify">
              <ShieldCheck /> Verify
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/import">
              <Import /> Import a transaction
            </Link>
          </Button>
          <Button asChild>
            <Link href="/add">
              <Plus /> Add a Safe
            </Link>
          </Button>
        </div>
      </div>
      <SafeList
        safes={mySafes.data?.safes}
        invalid={mySafes.data?.invalid.length ?? 0}
        empty="No Safes yet."
      />
      <h2 className="text-lg font-semibold">Recent</h2>
      <SafeList
        safes={recent.data?.safes}
        invalid={recent.data?.invalid.length ?? 0}
        empty="Safes you open from shared links appear here."
      />
    </div>
  )
}

function SafeList(props: { safes?: readonly SafeRecord[]; invalid: number; empty: string }) {
  const settings = useLoadedSettings()
  const book = useAddressBook()
  const chainName = (id: number) => settings.chains.find((c) => c.id === id)?.name ?? `Chain ${id}`
  return (
    <div className="flex flex-col gap-2">
      {props.safes?.length === 0 && <p className="text-muted-foreground">{props.empty}</p>}
      <ul className="flex flex-col divide-y rounded-lg border empty:hidden" data-testid="safe-list">
        {props.safes?.map((s) => (
          <li key={`${s.chainId}:${s.address}`}>
            <Link
              href={`/safe/${s.chainId}/${s.address}`}
              className="flex items-center justify-between gap-4 p-3 hover:bg-muted"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                {book.data && labelFor(book.data.entries, s.chainId, s.address) && (
                  <span className="truncate font-medium">
                    {labelFor(book.data.entries, s.chainId, s.address)}
                  </span>
                )}
                <span className="font-mono text-sm">{shortAddress(s.address)}</span>
              </span>
              <span className="text-sm text-muted-foreground">
                {chainName(s.chainId)} · v{s.version}
                {s.lastSeen && ` · ${s.lastSeen.threshold} of ${s.lastSeen.ownerCount}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {props.invalid > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {props.invalid} stored record(s) failed validation and were not used.
        </p>
      )}
    </div>
  )
}
