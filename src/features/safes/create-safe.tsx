// Create a Safe (SPEC §3.14): chain, owners, threshold → review (official contracts checked by
// code hash, the new address known in advance) → the wallet sends one transaction to Safe's
// factory → the new Safe is checked like any added one and saved to My Safes.
import { ExternalLink, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type Address, bytesToHex } from 'viem'
import { useConnection } from 'wagmi'
import { useLocation } from 'wouter'
import { explorerUrl } from '@/chains'
import { AddressView } from '@/components/address'
import { AddressField } from '@/components/inputs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type CreationPlan, ownersProblem, planCreation } from '@/core/create-safe'
import { describeError } from '@/lib/errors'
import { shortAddress } from '@/lib/format'
import { useResolvedAddress } from '@/queries/ens'
import { useCreationCheck } from '@/queries/safes'
import { useLoadedSettings } from '@/queries/settings'
import { AddTabs, ChainPicker, OTHER } from './add-safe'
import { useCreateSafe } from './use-create-safe'

interface OwnerInput {
  readonly id: number
  readonly text: string
  readonly address?: Address | undefined
}

/** A fresh random saltNonce per form, so the same owners can create more than one Safe. */
const randomSaltNonce = () => BigInt(bytesToHex(crypto.getRandomValues(new Uint8Array(32))))

export function CreateSafe() {
  const settings = useLoadedSettings()
  const connection = useConnection()
  const [chainValue, setChainValue] = useState(String(settings.chains[0]?.id ?? OTHER))
  const [owners, setOwners] = useState<readonly OwnerInput[]>(() => [
    { id: 0, text: connection.address ?? '' },
  ])
  const [nextId, setNextId] = useState(1)
  const [threshold, setThreshold] = useState(1)
  const [name, setName] = useState('')
  const [saltNonce] = useState(randomSaltNonce)
  const [reviewing, setReviewing] = useState(false)

  const chainId = chainValue === OTHER ? undefined : Number(chainValue)
  const t = Math.min(threshold, owners.length)
  const addresses = owners.map((o) => o.address)
  const complete = addresses.every((a): a is Address => !!a)
  const problem = complete ? ownersProblem(addresses, t) : undefined
  const plan =
    chainId !== undefined && complete && !problem
      ? planCreation({ chainId, owners: addresses, threshold: t, saltNonce })
      : undefined

  // Any edit goes back to the form: the review is always of what's shown
  const edit =
    <A extends unknown[]>(f: (...a: A) => void) =>
    (...a: A) => {
      f(...a)
      setReviewing(false)
    }
  const setOwner = (id: number, patch: Partial<OwnerInput>) =>
    setOwners((list) => list.map((o) => (o.id === id ? { ...o, ...patch } : o)))

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Add a Safe</h1>
      <AddTabs current="new" />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (plan) setReviewing(true)
        }}
      >
        <ChainPicker value={chainValue} onChange={edit(setChainValue)} />
        <div className="flex flex-col gap-3">
          {owners.map((o, i) => (
            <OwnerRow
              key={o.id}
              chainId={chainId ?? 1}
              label={`Owner ${i + 1}`}
              text={o.text}
              onText={edit((text: string) => setOwner(o.id, { text }))}
              onResolved={(address) => setOwner(o.id, { address })}
              {...(owners.length > 1
                ? { onRemove: edit(() => setOwners((l) => l.filter((x) => x.id !== o.id))) }
                : {})}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={edit(() => {
              setOwners((l) => [...l, { id: nextId, text: '' }])
              setNextId((n) => n + 1)
            })}
          >
            <Plus /> Add owner
          </Button>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="threshold">Signatures needed</Label>
          <div className="flex items-center gap-2 text-sm">
            <select
              id="threshold"
              value={t}
              onChange={(e) => edit(setThreshold)(Number(e.target.value))}
              className="h-9 w-20 rounded-lg border bg-background px-2 text-sm"
            >
              {owners.map((o, i) => (
                <option key={o.id} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">
              of {owners.length} owner{owners.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="safe-name">Name (optional, saved to your address book)</Label>
          <Input
            id="safe-name"
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team treasury"
          />
        </div>
        {problem && <p className="text-sm text-destructive">{problem}</p>}
        {!reviewing && (
          <Button type="submit" className="self-start" disabled={!plan}>
            Review
          </Button>
        )}
      </form>
      {reviewing && plan && <Review plan={plan} name={name} />}
    </div>
  )
}

function OwnerRow(props: {
  chainId: number
  label: string
  text: string
  onText: (text: string) => void
  onResolved: (address: Address | undefined) => void
  onRemove?: () => void
}) {
  const resolved = useResolvedAddress(props.chainId, props.text)
  // biome-ignore lint/correctness/useExhaustiveDependencies: report only when the address changes
  useEffect(() => props.onResolved(resolved.address), [resolved.address])
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <AddressField
          label={props.label}
          chainId={props.chainId}
          value={props.text}
          onChange={props.onText}
        />
      </div>
      {props.onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mt-6"
          aria-label={`Remove ${props.label.toLowerCase()}`}
          onClick={props.onRemove}
        >
          <X />
        </Button>
      )}
    </div>
  )
}

function Review({ plan, name }: { plan: CreationPlan; name: string }) {
  const settings = useLoadedSettings()
  const connection = useConnection()
  const check = useCreationCheck(plan, connection.address)
  const create = useCreateSafe()
  const [, navigate] = useLocation()
  const chain = settings.chains.find((c) => c.id === plan.chainId)
  const { version, l2, singleton, factory, fallbackHandler } = plan.contracts
  const txLink = create.txHash && chain ? explorerUrl(chain, 'tx', create.txHash) : undefined

  return (
    <Card data-testid="create-review">
      <CardHeader>
        <CardTitle>Review</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">
            Your new Safe on {chain?.name ?? `chain ${plan.chainId}`}
          </span>
          <span className="font-mono break-all" data-testid="predicted-address">
            {plan.address}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">
            {plan.threshold} of {plan.owners.length} must sign
          </span>
          <ul className="flex flex-col gap-1">
            {plan.owners.map((o) => (
              <li key={o}>
                <AddressView chainId={plan.chainId} address={o} />
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-1">
          <span>
            {singleton.contractName} v{version}{' '}
            <span className="text-muted-foreground">
              {l2
                ? '(the edition for L2s: it emits an event for each transaction)'
                : '(the edition for Mainnet and Sepolia)'}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            Factory {shortAddress(factory.address)} · fallback handler{' '}
            {shortAddress(fallbackHandler.address)} · no modules, no guard
          </span>
        </div>

        <div data-testid="create-check" data-status={check.status}>
          {check.isPending && (
            <p className="text-muted-foreground">
              Checking Safe's contracts on {chain?.name ?? `chain ${plan.chainId}`}…
            </p>
          )}
          {check.error && <p className="text-destructive">{describeError(check.error)}</p>}
          {check.data && (
            <p className="text-emerald-700 dark:text-emerald-400">
              The factory, singleton and fallback handler match Safe's official code, and the
              factory creates exactly this address.
            </p>
          )}
        </div>

        {!connection.address && (
          <p className="text-muted-foreground">Connect a wallet to pay the gas and create it.</p>
        )}
        {create.error && (
          <p className="text-destructive" data-testid="create-error">
            {describeError(create.error).split('\n')[0]}
          </p>
        )}
        {create.step === 'pending' && (
          <p>
            Waiting for {create.txHash}…{' '}
            {txLink && (
              <a
                href={txLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                explorer <ExternalLink className="size-3" />
              </a>
            )}
          </p>
        )}
        <Button
          className="self-start"
          data-testid="create-safe"
          disabled={!connection.address || !check.data || create.isPending}
          onClick={() =>
            create.mutate(
              { plan, name },
              { onSuccess: () => navigate(`/safe/${plan.chainId}/${plan.address}`) },
            )
          }
        >
          {create.step === 'checking'
            ? 'Checking…'
            : create.step === 'wallet'
              ? 'Confirm in your wallet…'
              : create.step === 'pending'
                ? 'Creating…'
                : create.step === 'verifying'
                  ? 'Checking the new Safe…'
                  : 'Create Safe'}
        </Button>
      </CardContent>
    </Card>
  )
}
