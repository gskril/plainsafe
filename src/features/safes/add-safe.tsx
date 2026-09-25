// Add a Safe (SPEC §3.2): chain + address, one pinned-block read, the authenticity check, labels.
import { useState } from 'react'
import type { Address } from 'viem'
import { Link, useLocation } from 'wouter'
import { AddressField } from '@/components/inputs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeError } from '@/lib/errors'
import { useResolvedAddress } from '@/queries/ens'
import { useAddressBook, useSafe, useSafeList, useSaveSafe, useSetLabels } from '@/queries/safes'
import { useLoadedSettings } from '@/queries/settings'
import { AddChain } from './add-chain'
import type { SafeSnapshot } from './load-safe'
import { SafeFacts } from './safe-summary'
import { labelFor } from './store'

const OTHER = 'other'

export function AddSafe() {
  const settings = useLoadedSettings()
  const [chainValue, setChainValue] = useState(String(settings.chains[0]?.id ?? OTHER))
  const [addressText, setAddressText] = useState('')
  const [target, setTarget] = useState<{ chainId: number; address: Address } | undefined>()

  const chainId = chainValue === OTHER ? undefined : Number(chainValue)
  const resolved = useResolvedAddress(chainId ?? 1, addressText)
  const addressOk = !!resolved.address
  const safe = useSafe(target?.chainId ?? 0, target?.address, !!target)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Add a Safe</h1>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (chainId !== undefined && resolved.address)
            setTarget({ chainId, address: resolved.address })
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="chain">Chain</Label>
          <select
            id="chain"
            value={chainValue}
            onChange={(e) => {
              setChainValue(e.target.value)
              setTarget(undefined)
            }}
            className="h-9 rounded-lg border bg-background px-2 text-sm"
          >
            {settings.chains.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.id})
              </option>
            ))}
            <option value={OTHER}>Other chain…</option>
          </select>
        </div>
        {chainValue === OTHER && <AddChain onAdded={(id) => setChainValue(String(id))} />}
        <SafeAddressField
          chainId={chainId}
          value={addressText}
          onChange={(v) => {
            setAddressText(v)
            setTarget(undefined)
          }}
        />
        <Button type="submit" className="self-start" disabled={chainId === undefined || !addressOk}>
          Check Safe
        </Button>
      </form>

      {target && safe.isFetching && !safe.data && (
        <p className="text-muted-foreground">Reading the Safe at the latest block…</p>
      )}
      {target && safe.error && (
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
      {target && safe.data && <Result safe={safe.data} />}
    </div>
  )
}

function Result({ safe }: { safe: SafeSnapshot }) {
  const mySafes = useSafeList('safes')
  const book = useAddressBook()
  const saveSafe = useSaveSafe('safes')
  const setLabels = useSetLabels()
  const [, navigate] = useLocation()
  const [labels, setLabelsState] = useState<Record<string, string>>({})
  const href = `/safe/${safe.chainId}/${safe.address}`
  const already = mySafes.data?.safes.some(
    (s) => s.chainId === safe.chainId && s.address.toLowerCase() === safe.address.toLowerCase(),
  )
  const a = safe.authenticity

  const add = async () => {
    if (a.status !== 'verified') return
    const entries = Object.entries(labels)
      .map(([address, label]) => ({
        chainId: safe.chainId,
        address: address as Address,
        label: label.trim(),
      }))
      .filter((e) => e.label)
    if (entries.length) await setLabels.mutateAsync(entries)
    await saveSafe.mutateAsync({
      chainId: safe.chainId,
      address: safe.address,
      version: a.version,
      l2: a.l2,
      addedAt: new Date().toISOString(),
      ...(safe.nonce !== undefined && safe.threshold !== undefined && safe.owners
        ? {
            lastSeen: {
              block: safe.block.toString(),
              nonce: safe.nonce.toString(),
              threshold: safe.threshold.toString(),
              ownerCount: safe.owners.length,
            },
          }
        : {}),
    })
    navigate(href)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-mono text-sm break-all">{safe.address}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <SafeFacts safe={safe} />
        {a.status === 'verified' && safe.owners && !already && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">
              Label owners (optional, saved to your address book)
            </h3>
            {safe.owners.map((o) => (
              <div key={o} className="flex items-center gap-2">
                <span className="w-32 shrink-0 font-mono text-xs">{`${o.slice(0, 8)}…${o.slice(-6)}`}</span>
                <Input
                  aria-label={`Label for ${o}`}
                  placeholder={
                    book.data ? (labelFor(book.data.entries, safe.chainId, o) ?? 'Label') : 'Label'
                  }
                  value={labels[o] ?? ''}
                  maxLength={64}
                  onChange={(e) => setLabelsState((l) => ({ ...l, [o]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {a.status === 'verified' && !already && (
            <Button onClick={() => void add()} disabled={saveSafe.isPending}>
              Add to My Safes
            </Button>
          )}
          {already && <span className="text-sm text-muted-foreground">Already in My Safes.</span>}
          <Button variant="outline" asChild>
            <Link href={href}>{a.status === 'verified' ? 'Open' : 'View read-only'}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function SafeAddressField(props: {
  chainId: number | undefined
  value: string
  onChange: (v: string) => void
}) {
  return (
    <AddressField
      label="Safe address"
      chainId={props.chainId ?? 1}
      value={props.value}
      onChange={props.onChange}
    />
  )
}
