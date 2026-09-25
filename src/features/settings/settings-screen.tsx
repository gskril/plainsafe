// #/settings and #/settings/:section (SPEC §3.12).
import { Link, useParams } from 'wouter'
import { NotFound } from '@/components/layout/placeholder'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import { useLoadedSettings, useSaveSettings } from '@/queries/settings'
import type { Currency } from '@/schemas/settings'
import { AbiSettings } from './abi-settings'
import { AddressBookSettings } from './address-book-settings'
import { BackupSettings } from './backup-settings'
import { ClearSigningSettings } from './clear-signing-settings'
import { NetworkAccessSettings, NetworkLogSettings } from './network-settings'
import { RpcSettings } from './rpc-settings'
import { TokensSettings } from './tokens-settings'

const SECTIONS = [
  ['rpcs', 'RPCs'],
  ['network', 'Network access'],
  ['log', 'Network log'],
  ['tokens', 'Token lists and My tokens'],
  ['addressbook', 'Address book'],
  ['clear-signing', 'Clear signing'],
  ['abis', 'ABI library'],
  ['currency', 'Currency'],
  ['backup', 'Back up and Restore'],
  ['about', 'About'],
] as const

const BUILT: readonly string[] = [
  'rpcs',
  'network',
  'log',
  'tokens',
  'addressbook',
  'clear-signing',
  'currency',
]

export function SettingsScreen() {
  const { section } = useParams<{ section?: string }>()
  const current = SECTIONS.find(([id]) => id === section)
  if (section && !current) return <NotFound />
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 md:flex-row">
      <nav className="flex shrink-0 flex-row flex-wrap gap-1 md:w-52 md:flex-col">
        {SECTIONS.map(([id, label]) => (
          <Link
            key={id}
            href={`/settings/${id}`}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm',
              id === section ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {!current && <p className="text-muted-foreground">Choose a section.</p>}
        {section === 'rpcs' && <RpcSettings />}
        {section === 'network' && <NetworkAccessSettings />}
        {section === 'log' && <NetworkLogSettings />}
        {section === 'tokens' && <TokensSettings />}
        {section === 'addressbook' && <AddressBookSettings />}
        {section === 'clear-signing' && <ClearSigningSettings />}
        {section === 'abis' && <AbiSettings />}
        {section === 'backup' && <BackupSettings />}
        {section === 'currency' && <CurrencySettings />}
        {current && !BUILT.includes(current[0]) && (
          <p className="text-muted-foreground">{current[1]}: not built yet (SPEC §16 step 14).</p>
        )}
      </div>
    </div>
  )
}

function CurrencySettings() {
  const settings = useLoadedSettings()
  const save = useSaveSettings()
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Currency</h2>
      <p className="text-sm text-muted-foreground">
        Values are ≈ spot prices from the 1inch Spot Price Aggregator (an on-chain contract) and are
        for display only. USD and EUR need a Mainnet RPC.
      </p>
      <RadioGroup
        value={settings.currency}
        onValueChange={(v) => save.mutate({ ...settings, currency: v as Currency })}
        className="flex gap-4"
      >
        {(['ETH', 'USD', 'EUR'] as const).map((c) => (
          <Label key={c} className="flex items-center gap-2 font-normal">
            <RadioGroupItem value={c} /> {c}
          </Label>
        ))}
      </RadioGroup>
    </section>
  )
}
