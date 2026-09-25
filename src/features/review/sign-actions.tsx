// The main button (SPEC §3.4): who may sign, and the typed confirmation for delegatecall.
import { useState } from 'react'
import { useConnection } from 'wagmi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  type Banner,
  isUnverified,
  needsTypedConfirmation,
  signingRefused,
} from '@/core/safety-rules'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { shortAddress } from '@/lib/format'

const CONFIRM_WORD = 'DELEGATECALL'

export type SignState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'no-wallet' }
  | { readonly kind: 'not-owner'; readonly account: string }
  | { readonly kind: 'signed' }
  | { readonly kind: 'can-sign' }

export function signState(args: {
  pending: boolean
  banners?: readonly Banner[] | undefined
  safe?: SafeSnapshot | undefined
  account?: string | undefined
  signers: readonly string[]
}): SignState {
  if (args.pending || !args.banners || !args.safe) return { kind: 'checking' }
  if (signingRefused(args.banners)) return { kind: 'refused' }
  if (!args.account) return { kind: 'no-wallet' }
  const a = args.account.toLowerCase()
  if (!args.safe.owners?.some((o) => o.toLowerCase() === a))
    return { kind: 'not-owner', account: args.account }
  if (args.signers.some((s) => s.toLowerCase() === a)) return { kind: 'signed' }
  return { kind: 'can-sign' }
}

export function SignButton(props: {
  banners?: readonly Banner[] | undefined
  safe?: SafeSnapshot | undefined
  pending: boolean
  signers: readonly string[]
  onSign: () => void
  busy: boolean
  error?: Error | null
  simulationFailed?: boolean
}) {
  const connection = useConnection()
  const [typed, setTyped] = useState('')
  const state = signState({
    pending: props.pending,
    banners: props.banners,
    safe: props.safe,
    account: connection.address,
    signers: props.signers,
  })
  const confirm = props.banners ? needsTypedConfirmation(props.banners) : false
  const label = props.simulationFailed
    ? 'Sign anyway'
    : props.banners && isUnverified(props.banners)
      ? 'Sign unverified transaction'
      : 'Sign'
  return (
    <div className="flex flex-col items-end gap-2">
      {state.kind === 'no-wallet' && (
        <p className="text-sm text-muted-foreground">
          Connect an owner's wallet (top right) to sign.
        </p>
      )}
      {state.kind === 'not-owner' && (
        <p className="text-sm text-muted-foreground">
          The connected account {shortAddress(state.account)} is not an owner of this Safe, so it
          can't sign.
        </p>
      )}
      {state.kind === 'signed' && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          You have signed this transaction.
        </p>
      )}
      {state.kind === 'can-sign' && confirm && (
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="delegatecall-confirm">
            Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm you
            understand this can take over the Safe:
          </label>
          <Input
            id="delegatecall-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="font-mono"
          />
        </div>
      )}
      {props.error && (
        <p className="max-w-md text-right text-sm text-destructive">
          {props.error.message.split('\n')[0]}
        </p>
      )}
      {(state.kind === 'can-sign' || state.kind === 'checking' || state.kind === 'refused') && (
        <Button
          size="lg"
          data-testid="main-action"
          disabled={state.kind !== 'can-sign' || props.busy || (confirm && typed !== CONFIRM_WORD)}
          onClick={props.onSign}
        >
          {state.kind === 'checking'
            ? 'Checking…'
            : state.kind === 'refused'
              ? 'Signing refused'
              : props.busy
                ? 'Waiting for the wallet…'
                : label}
        </Button>
      )}
    </div>
  )
}
