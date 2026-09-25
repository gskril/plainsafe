// Decoded fields at their trust level (SPEC §7.1), with raw fields folded away elsewhere.
import { type Address, formatUnits, getAddress, isAddress } from 'viem'
import { AddressView } from '@/components/address'
import { applyOwnerChange, type OwnerChange } from '@/core/builders'
import type { Decoded } from '@/core/decode'
import type { SafeTx } from '@/core/safe-tx'
import { OwnerDiff } from '@/features/builder/presets'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { cn } from '@/lib/utils'
import { useTokenMeta } from '@/queries/contracts'
import { useLoadedSettings } from '@/queries/settings'
import { useTokenUniverse } from '@/queries/tokens'

export function TrustBadge({ decoded }: { decoded: Decoded }) {
  const [text, tone] =
    decoded.kind === 'empty'
      ? ['No calldata: value transfer', 'ok']
      : decoded.kind === 'abi'
        ? [`Decoded (${decoded.source})`, 'ok']
        : ['Unverified: raw calldata', 'warn']
  return (
    <span
      data-testid="trust-badge"
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'ok'
          ? 'bg-muted text-foreground'
          : 'bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100',
      )}
    >
      {text}
    </span>
  )
}

function ownerChangeOf(decoded: Decoded): OwnerChange | undefined {
  if (decoded.kind !== 'abi' || decoded.source !== 'Safe') return undefined
  const v = decoded.args.map((a) => a.value)
  switch (decoded.functionName) {
    case 'addOwnerWithThreshold':
      return { kind: 'add', owner: v[0] as Address, threshold: v[1] as bigint }
    case 'removeOwner':
      return { kind: 'remove', owner: v[1] as Address, threshold: v[2] as bigint }
    case 'swapOwner':
      return { kind: 'swap', oldOwner: v[1] as Address, newOwner: v[2] as Address }
    case 'changeThreshold':
      return { kind: 'threshold', threshold: v[0] as bigint }
  }
  return undefined
}

export function DecodedView({
  chainId,
  tx,
  decoded,
  safe,
}: {
  chainId: number
  tx: SafeTx
  decoded: Decoded
  safe?: SafeSnapshot
}) {
  const settings = useLoadedSettings()
  const currency = settings.chains.find((c) => c.id === chainId)?.nativeCurrency
  const erc20 =
    decoded.kind === 'abi' &&
    decoded.source.startsWith('ERC-20') &&
    ['transfer', 'approve', 'transferFrom'].includes(decoded.functionName)
  const universe = useTokenUniverse(chainId)
  const listed = erc20
    ? universe?.find((t) => t.address.toLowerCase() === tx.to.toLowerCase())
    : undefined
  const meta = useTokenMeta(chainId, erc20 && universe && !listed ? tx.to : undefined)
  const token = listed
    ? { symbol: listed.symbol, decimals: listed.decimals, source: `from ${listed.source}` }
    : meta.data
      ? {
          symbol: meta.data.symbol,
          decimals: meta.data.decimals,
          source: 'not in your lists; read from the token contract',
        }
      : undefined
  const change = ownerChangeOf(decoded)

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" data-testid="details">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Details</h2>
        <TrustBadge decoded={decoded} />
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{tx.operation === 1 ? 'Delegatecall to' : 'To'}</dt>
        <dd>
          <AddressView chainId={chainId} address={tx.to} />
        </dd>
        {(tx.value > 0n || decoded.kind === 'empty') && (
          <>
            <dt className="text-muted-foreground">Value</dt>
            <dd>
              {currency
                ? `${formatUnits(tx.value, currency.decimals)} ${currency.symbol}`
                : tx.value.toString()}
            </dd>
          </>
        )}
        {decoded.kind === 'abi' && (
          <>
            <dt className="text-muted-foreground">Function</dt>
            <dd className="font-mono text-xs">{decoded.signature}</dd>
            {decoded.args.map((a) => (
              <ArgRow
                key={a.name}
                chainId={chainId}
                name={a.name}
                type={a.type}
                value={a.value}
                amount={
                  erc20 && a.type === 'uint256' && token
                    ? `${formatUnits(a.value as bigint, token.decimals)} ${token.symbol} (symbol ${token.source})`
                    : undefined
                }
              />
            ))}
          </>
        )}
        {decoded.kind === 'raw' && (
          <>
            <dt className="text-muted-foreground">Selector</dt>
            <dd className="font-mono text-xs">{decoded.selector ?? '(none)'}</dd>
            <dt className="text-muted-foreground">Calldata</dt>
            <dd className="font-mono text-xs break-all">{tx.data}</dd>
          </>
        )}
      </dl>
      {change && safe?.owners && safe.threshold !== undefined && (
        <OwnerDiff
          chainId={chainId}
          before={{ owners: safe.owners, threshold: safe.threshold }}
          after={applyOwnerChange(safe.owners, safe.threshold, change)}
        />
      )}
    </section>
  )
}

function ArgRow(props: {
  chainId: number
  name: string
  type: string
  value: unknown
  amount?: string | undefined
}) {
  const text = (v: unknown): string =>
    typeof v === 'bigint'
      ? v.toString()
      : Array.isArray(v)
        ? `[${v.map(text).join(', ')}]`
        : typeof v === 'object' && v !== null
          ? JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x))
          : String(v)
  return (
    <>
      <dt className="text-muted-foreground">
        {props.name} <span className="font-mono text-xs">{props.type}</span>
      </dt>
      <dd className="break-all">
        {props.type === 'address' && typeof props.value === 'string' && isAddress(props.value) ? (
          <AddressView chainId={props.chainId} address={getAddress(props.value)} />
        ) : (
          <span className="font-mono text-xs">{text(props.value)}</span>
        )}
        {props.amount && <span className="block text-muted-foreground">{props.amount}</span>}
      </dd>
    </>
  )
}
