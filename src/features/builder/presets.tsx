// The builder presets' forms (SPEC §3.3). Each reports a call (or undefined while invalid).
import { useEffect, useState } from 'react'
import { type Address, formatUnits, getAddress } from 'viem'
import { AddressView } from '@/components/address'
import { AddressField, AmountField, parseAddressInput, parseAmount } from '@/components/inputs'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  applyOwnerChange,
  type OwnerChange,
  ownerChangeCall,
  ownerChangeProblem,
  sendErc20,
  sendNative,
  type TxCall,
} from '@/core/builders'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { describeError } from '@/lib/errors'
import { shortAddress } from '@/lib/format'
import { useTokenMeta } from '@/queries/contracts'
import { useLoadedSettings } from '@/queries/settings'
import { useBalances, useTokenUniverse } from '@/queries/tokens'

export interface BuiltCall {
  readonly call: TxCall
  readonly description: string
}

export interface PresetProps {
  readonly safe: SafeSnapshot
  readonly onResult: (r: BuiltCall | undefined) => void
}

/** Report the result whenever it changes (compared by content). */
export function useReport(result: BuiltCall | undefined, onResult: PresetProps['onResult']) {
  const key = result
    ? JSON.stringify(result, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
    : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` captures `result`
  useEffect(() => onResult(result), [key])
}

export function SendNative({ safe, onResult }: PresetProps) {
  const settings = useLoadedSettings()
  const currency = settings.chains.find((c) => c.id === safe.chainId)?.nativeCurrency ?? {
    symbol: 'ETH',
    decimals: 18,
    name: 'Ether',
  }
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const recipient = parseAddressInput(to)
  const value = parseAmount(amount, currency.decimals)
  const result =
    recipient && value !== undefined
      ? {
          call: sendNative(recipient, value),
          description: `Send ${formatUnits(value, currency.decimals)} ${currency.symbol} to ${shortAddress(recipient)}`,
        }
      : undefined
  useReport(result, onResult)
  return (
    <div className="flex flex-col gap-4">
      <AddressField label="Recipient" chainId={safe.chainId} value={to} onChange={setTo} />
      <AmountField
        label="Amount"
        value={amount}
        onChange={setAmount}
        decimals={currency.decimals}
        symbol={currency.symbol}
        max={safe.balance}
      />
    </div>
  )
}

export function SendErc20({ safe, onResult }: PresetProps) {
  const universe = useTokenUniverse(safe.chainId)
  const balances = useBalances(safe.chainId, safe.address)
  const [choice, setChoice] = useState('')
  const [tokenText, setTokenText] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const listed = universe?.find((t) => t.address.toLowerCase() === choice.toLowerCase())
  const other = choice === OTHER ? parseAddressInput(tokenText) : undefined
  // A token by address that turns out to be in the lists uses the list's entry.
  const listedOther = other
    ? universe?.find((t) => t.address.toLowerCase() === other.toLowerCase())
    : undefined
  const meta = useTokenMeta(safe.chainId, listedOther ? undefined : other)
  const token =
    listed ??
    listedOther ??
    (meta.data
      ? {
          ...meta.data,
          name: meta.data.name ?? '',
          source: 'the token contract',
          chainId: safe.chainId,
        }
      : undefined)
  const held = token
    ? balances.data?.tokens.find(
        (t) => t.token.address.toLowerCase() === token.address.toLowerCase(),
      )?.balance
    : undefined
  const recipient = parseAddressInput(to)
  const value = token ? parseAmount(amount, token.decimals) : undefined
  const result =
    token && recipient && value !== undefined
      ? {
          call: sendErc20(token.address, recipient, value),
          description: `Send ${formatUnits(value, token.decimals)} ${token.symbol} to ${shortAddress(recipient)}`,
        }
      : undefined
  useReport(result, onResult)
  const withBalance = (universe ?? [])
    .map((t) => ({
      t,
      b: balances.data?.tokens.find((x) => x.token.address === t.address)?.balance ?? 0n,
    }))
    .sort((x, y) => (y.b > x.b ? 1 : y.b < x.b ? -1 : x.t.symbol.localeCompare(y.t.symbol)))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="token">Token</Label>
        <select
          id="token"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="h-9 rounded-lg border bg-background px-2 text-sm"
        >
          <option value="">Choose a token…</option>
          {withBalance.map(({ t, b }) => (
            <option key={t.address} value={t.address}>
              {t.symbol} · {shortAddress(t.address)} · {formatUnits(b, t.decimals)} · from{' '}
              {t.source}
            </option>
          ))}
          <option value={OTHER}>Other token (by address)…</option>
        </select>
      </div>
      {choice === OTHER && (
        <AddressField
          label="Token contract"
          chainId={safe.chainId}
          value={tokenText}
          onChange={setTokenText}
        />
      )}
      {other && !listedOther && meta.isPending && (
        <p className="text-sm text-muted-foreground">Reading the token…</p>
      )}
      {meta.error && <p className="text-sm text-destructive">{describeError(meta.error)}</p>}
      {token && (
        <p className="text-sm text-muted-foreground" data-testid="token-source">
          {token.symbol}, {token.decimals} decimals, from {token.source}
          {token.source === 'the token contract' &&
            ' (not in your lists). It is identified by its address, not its symbol'}
          .
        </p>
      )}
      <AddressField label="Recipient" chainId={safe.chainId} value={to} onChange={setTo} />
      {token && (
        <AmountField
          label="Amount"
          value={amount}
          onChange={setAmount}
          decimals={token.decimals}
          symbol={token.symbol}
          max={held}
        />
      )}
    </div>
  )
}

const OTHER = 'other'

type OwnerAction = OwnerChange['kind']

export function OwnersAndThreshold({ safe, onResult }: PresetProps) {
  const owners = safe.owners ?? []
  const threshold = safe.threshold ?? 1n
  const [action, setAction] = useState<OwnerAction>('add')
  const [newOwner, setNewOwner] = useState('')
  const [target, setTarget] = useState<string>(owners[0] ?? '')
  const [newThreshold, setNewThreshold] = useState(threshold.toString())

  const t = /^\d+$/.test(newThreshold) ? BigInt(newThreshold) : undefined
  const fresh = parseAddressInput(newOwner)
  const change: OwnerChange | undefined = (() => {
    switch (action) {
      case 'add':
        return fresh && t !== undefined ? { kind: 'add', owner: fresh, threshold: t } : undefined
      case 'remove':
        return target && t !== undefined
          ? { kind: 'remove', owner: target as Address, threshold: t }
          : undefined
      case 'swap':
        return target && fresh
          ? { kind: 'swap', oldOwner: target as Address, newOwner: fresh }
          : undefined
      case 'threshold':
        return t !== undefined ? { kind: 'threshold', threshold: t } : undefined
    }
  })()
  const problem = change ? ownerChangeProblem(safe.address, owners, threshold, change) : undefined
  const after = change && !problem ? applyOwnerChange(owners, threshold, change) : undefined
  const describe = (c: OwnerChange) => {
    switch (c.kind) {
      case 'add':
        return `Add owner ${shortAddress(c.owner)} and set threshold to ${c.threshold}`
      case 'remove':
        return `Remove owner ${shortAddress(c.owner)} and set threshold to ${c.threshold}`
      case 'swap':
        return `Replace owner ${shortAddress(c.oldOwner)} with ${shortAddress(c.newOwner)}`
      case 'threshold':
        return `Change threshold to ${c.threshold}`
    }
  }
  const result =
    change && !problem
      ? { call: ownerChangeCall(safe.address, owners, change), description: describe(change) }
      : undefined
  useReport(result, onResult)

  const ownerCountAfter =
    action === 'add' ? owners.length + 1 : action === 'remove' ? owners.length - 1 : owners.length
  return (
    <div className="flex flex-col gap-4">
      <RadioGroup
        value={action}
        onValueChange={(v) => setAction(v as OwnerAction)}
        className="grid gap-2 sm:grid-cols-2"
      >
        {(
          [
            ['add', 'Add an owner'],
            ['remove', 'Remove an owner'],
            ['swap', 'Replace an owner'],
            ['threshold', 'Change the threshold'],
          ] as const
        ).map(([value, label]) => (
          <Label key={value} className="flex items-center gap-2 font-normal">
            <RadioGroupItem value={value} /> {label}
          </Label>
        ))}
      </RadioGroup>
      {(action === 'remove' || action === 'swap') && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="owner-select">
            {action === 'remove' ? 'Owner to remove' : 'Owner to replace'}
          </Label>
          <select
            id="owner-select"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-9 rounded-lg border bg-background px-2 font-mono text-sm"
          >
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      )}
      {(action === 'add' || action === 'swap') && (
        <AddressField
          label="New owner"
          chainId={safe.chainId}
          value={newOwner}
          onChange={setNewOwner}
        />
      )}
      {action !== 'swap' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="threshold">New threshold (of {ownerCountAfter} owners)</Label>
          <select
            id="threshold"
            value={newThreshold}
            onChange={(e) => setNewThreshold(e.target.value)}
            className="h-9 w-32 rounded-lg border bg-background px-2 text-sm"
          >
            {Array.from({ length: Math.max(ownerCountAfter, 1) }, (_, i) => String(i + 1)).map(
              (n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ),
            )}
          </select>
        </div>
      )}
      {problem && <p className="text-sm text-destructive">{problem}</p>}
      {after && <OwnerDiff chainId={safe.chainId} before={{ owners, threshold }} after={after} />}
    </div>
  )
}

/** Before → after view of owners and threshold (SPEC §7.4 orange rule). */
export function OwnerDiff(props: {
  chainId: number
  before: { owners: readonly Address[]; threshold: bigint }
  after: { owners: readonly Address[]; threshold: bigint }
}) {
  const had = new Set(props.before.owners.map((o) => o.toLowerCase()))
  const has = new Set(props.after.owners.map((o) => o.toLowerCase()))
  const all = [
    ...props.before.owners,
    ...props.after.owners.filter((o) => !had.has(o.toLowerCase())),
  ]
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm dark:border-orange-900 dark:bg-orange-950/40"
      data-testid="owner-diff"
    >
      <p className="font-medium">
        Threshold: {props.before.threshold.toString()} of {props.before.owners.length} →{' '}
        {props.after.threshold.toString()} of {props.after.owners.length}
      </p>
      <ul className="flex flex-col gap-1">
        {all.map((o) => {
          const removed = !has.has(o.toLowerCase())
          const added = !had.has(o.toLowerCase())
          return (
            <li key={o} className="flex items-center gap-2">
              <span
                className={
                  removed
                    ? 'w-16 text-red-700 dark:text-red-400'
                    : added
                      ? 'w-16 text-emerald-700 dark:text-emerald-400'
                      : 'w-16 text-muted-foreground'
                }
              >
                {removed ? 'removed' : added ? 'added' : 'stays'}
              </span>
              <AddressView chainId={props.chainId} address={getAddress(o)} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
