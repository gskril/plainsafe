// #/verify (SPEC §3.10): recompute a Safe transaction's hashes with no wallet and no RPC, from a
// shared package or from the individual fields. "Check against chain" is optional and saves
// nothing.
import { Either } from 'effect'
import { useMemo, useState } from 'react'
import { type Address, formatUnits, type Hex } from 'viem'
import { Link, useLocation } from 'wouter'
import { AddressView } from '@/components/address'
import { FileButton } from '@/components/file-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Decoded } from '@/core/decode'
import { describeCall, tokenLookup } from '@/core/describe'
import { decodeOffline } from '@/core/offline-decode'
import {
  classifySigners,
  type PackageProblem,
  parseShared,
  SUPPORTED_PACKAGE_VERSIONS,
  type VerifiedPackage,
  verifyPackage,
} from '@/core/package'
import { safeTxHashes } from '@/core/safe-tx'
import { Callout } from '@/features/review/banners'
import { WhatsabiChecks } from '@/features/review/checks'
import { ClearSigningView } from '@/features/review/clear-signing-view'
import { HashesPanel } from '@/features/review/hashes'
import { TxFields } from '@/features/review/tx-fields'
import { AuthenticityBadge } from '@/features/safes/authenticity-badge'
import { isSetupDone, setReturnTo } from '@/features/setup/return-to'
import { RouterCommands } from '@/features/swap/router-view'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useClearSigningFor } from '@/queries/clear-signing'
import { useInspect } from '@/queries/contracts'
import { useSafe } from '@/queries/safes'
import { useLoadedSettings } from '@/queries/settings'
import { useTokenUniverse } from '@/queries/tokens'
import { emptyFields, type FieldValues, type Parsed, parseFields, toFields } from './fields'

type Mode = 'paste' | 'fields'

function problemText(p: PackageProblem): string {
  return p._tag === 'HashMismatch'
    ? `The package's ${p.field} hash (${p.claimed}) doesn't match the one computed from its contents (${p.computed}). It was changed or corrupted.`
    : `This isn't a valid Plain Safe package. ${p.message}`
}

export function VerifyScreen() {
  const [mode, setMode] = useState<Mode>('paste')
  const [pkg, setPkg] = useState<VerifiedPackage>()
  const [fields, setFields] = useState<FieldValues>(emptyFields)
  const parsed = useMemo(() => parseFields(fields), [fields])

  const fromPackage: Parsed | undefined = pkg && {
    chainId: pkg.pkg.chainId,
    safe: pkg.pkg.safe as Address,
    version: pkg.pkg.safeVersion,
    tx: pkg.tx,
  }
  const current = mode === 'paste' ? fromPackage : parsed.ok ? parsed.value : undefined

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Verify a transaction</h1>
        <p className="text-sm text-muted-foreground">
          Recompute a Safe transaction's hashes in this browser, with no wallet and no RPC, and
          compare them with your wallet or hardware device screen. Nothing you enter is saved.
        </p>
      </div>
      <div className="flex gap-2" role="tablist">
        {(
          [
            ['paste', 'Link, code, JSON or file'],
            ['fields', 'Enter the fields'],
          ] as const
        ).map(([m, label]) => (
          <Button
            key={m}
            role="tab"
            aria-selected={mode === m}
            variant={mode === m ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode(m)}
          >
            {label}
          </Button>
        ))}
      </div>

      {mode === 'paste' ? (
        <PasteInput
          onVerified={setPkg}
          onEdit={
            fromPackage
              ? () => {
                  setFields(toFields(fromPackage))
                  setMode('fields')
                }
              : undefined
          }
        />
      ) : (
        <FieldsForm fields={fields} onChange={setFields} errors={parsed.ok ? {} : parsed.errors} />
      )}

      {current && (
        <VerifyResult
          key={`${current.chainId}:${current.safe}`}
          parsed={current}
          pkg={mode === 'paste' ? pkg : undefined}
        />
      )}
    </div>
  )
}

function PasteInput(props: {
  onVerified: (v: VerifiedPackage | undefined) => void
  onEdit?: (() => void) | undefined
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const submit = async (input: string) => {
    setError(undefined)
    props.onVerified(undefined)
    try {
      const v = await verifyPackage(await parseShared(input))
      if (Either.isLeft(v)) return setError(problemText(v.left))
      props.onVerified(v.right)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <textarea
        aria-label="Link, code or JSON"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const file = e.dataTransfer.files[0]
          if (!file) return
          e.preventDefault()
          void file.text().then((t) => {
            setText(t)
            return submit(t)
          })
        }}
        rows={5}
        spellCheck={false}
        placeholder="https://…/#/import/…, plainsafe:1:…, or package JSON"
        className="rounded-lg border bg-background p-2 font-mono text-xs"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void submit(text)} disabled={!text.trim()}>
          Verify
        </Button>
        <FileButton label="Choose a file" onFile={(f) => f.text().then(submit)} />
        {props.onEdit && (
          <Button variant="ghost" size="sm" onClick={props.onEdit}>
            Edit these fields
          </Button>
        )}
      </div>
      {error && (
        <div data-testid="verify-rejected">
          <Callout severity="red" title="Rejected">
            {error}
          </Callout>
        </div>
      )}
    </div>
  )
}

const FIELD_ROWS: readonly [keyof FieldValues, string, string?][] = [
  ['chainId', 'Chain ID'],
  ['safe', 'Safe address'],
  ['to', 'to'],
  ['value', 'value', 'in wei'],
  ['data', 'data'],
  ['safeTxGas', 'safeTxGas'],
  ['baseGas', 'baseGas'],
  ['gasPrice', 'gasPrice'],
  ['gasToken', 'gasToken'],
  ['refundReceiver', 'refundReceiver'],
  ['nonce', 'nonce'],
]

function FieldsForm(props: {
  fields: FieldValues
  onChange: (f: FieldValues) => void
  errors: Partial<Record<keyof FieldValues, string>>
}) {
  const set = (k: keyof FieldValues, v: string) => props.onChange({ ...props.fields, [k]: v })
  const field = (k: keyof FieldValues, label: string, hint?: string) => (
    <div key={k} className="flex flex-col gap-1">
      <Label htmlFor={`verify-${k}`}>
        {label}
        {hint && <span className="font-normal text-muted-foreground"> ({hint})</span>}
      </Label>
      {k === 'data' ? (
        <textarea
          id={`verify-${k}`}
          value={props.fields[k]}
          onChange={(e) => set(k, e.target.value)}
          rows={3}
          spellCheck={false}
          className="rounded-lg border bg-background p-2 font-mono text-xs"
        />
      ) : (
        <Input
          id={`verify-${k}`}
          value={props.fields[k]}
          onChange={(e) => set(k, e.target.value)}
          spellCheck={false}
          className="font-mono text-xs"
        />
      )}
      {props.errors[k] && <p className="text-xs text-destructive">{props.errors[k]}</p>}
    </div>
  )
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="verify-fields">
      {FIELD_ROWS.slice(0, 2).map(([k, l, h]) => field(k, l, h))}
      <div className="flex flex-col gap-1">
        <Label htmlFor="verify-version">Safe version</Label>
        <select
          id="verify-version"
          value={props.fields.version}
          onChange={(e) => set('version', e.target.value)}
          className="h-9 rounded-lg border bg-background px-2 text-sm"
        >
          {[...SUPPORTED_PACKAGE_VERSIONS].map((v) => (
            <option key={v} value={v}>
              v{v}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="verify-operation">operation</Label>
        <select
          id="verify-operation"
          value={props.fields.operation}
          onChange={(e) => set('operation', e.target.value)}
          className="h-9 rounded-lg border bg-background px-2 text-sm"
        >
          <option value="0">0 (call)</option>
          <option value="1">1 (delegatecall)</option>
        </select>
      </div>
      {FIELD_ROWS.slice(2).map(([k, l, h]) => (
        <div key={k} className={cn(k === 'data' || k === 'to' ? 'sm:col-span-2' : '')}>
          {field(k, l, h)}
        </div>
      ))}
    </div>
  )
}

function VerifyResult({ parsed, pkg }: { parsed: Parsed; pkg?: VerifiedPackage | undefined }) {
  const settings = useLoadedSettings()
  const { chainId, safe, version, tx } = parsed
  const chain = settings.chains.find((c) => c.id === chainId)
  const hashes = safeTxHashes(chainId, safe, tx)
  const toSafe = tx.to.toLowerCase() === safe.toLowerCase()
  const decoded = decodeOffline(chainId, safe, tx, (name) => `${name} standard ABI`)
  // Offline: bundled and imported descriptors only, for the claimed version (SPEC §3.10, §7.1)
  const clear = useClearSigningFor({ chainId, safe, version, l2: false }, tx, hashes.safeTx, true)
  const currency = chain?.nativeCurrency ?? { symbol: 'ETH', decimals: 18 }
  // The token lists are local: no network, as the page promises (SPEC §3.10)
  const tokens = useTokenUniverse(chainId)
  const summary =
    (!toSafe ? clear.data?.summary : undefined) ??
    describeCall(tx, decoded, safe, currency, tokenLookup(tokens))

  return (
    <div className="flex flex-col gap-5" data-testid="verify-result">
      <section className="flex flex-col gap-1 text-sm">
        <p className="text-muted-foreground">
          {chain?.name ?? `Chain ${chainId}`} · claims Safe v{version} · nonce {tx.nonce.toString()}
        </p>
        <AddressView chainId={chainId} address={safe} full />
      </section>
      <h2 className="text-lg font-semibold" data-testid="verify-summary">
        {summary}
      </h2>
      {pkg?.pkg.note && (
        <p className="rounded-lg border border-dashed p-3 text-sm">
          <span className="font-medium">Proposer's note (unverified): </span>
          {pkg.pkg.note}
        </p>
      )}
      {tx.operation === 1 && (
        <Callout severity="red" title="Delegatecall">
          The target's code runs as the Safe itself, with full control over its funds, owners and
          modules. Only sign if the target is a contract you trust for this.
        </Callout>
      )}
      <HashesPanel hashes={hashes} />
      <OfflineDecoding
        chainId={chainId}
        safe={safe}
        decoded={decoded}
        tx={tx}
        currency={currency}
      />
      {clear.data && (
        <details className="rounded-lg border px-4 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Clear-signing view</summary>
          <div className="mt-3 mb-2">
            <ClearSigningView chainId={chainId} result={clear.data} />
          </div>
        </details>
      )}
      {pkg && <OfflineSignatures pkg={pkg} />}
      <TxFields chainId={chainId} tx={tx} />
      <ChainCheck parsed={parsed} signers={pkg?.signatures.map((s) => s.signer) ?? []} />
    </div>
  )
}

function OfflineDecoding({
  chainId,
  safe,
  decoded,
  tx,
  currency,
}: {
  chainId: number
  safe: Address
  decoded: Decoded
  tx: Parsed['tx']
  currency: { symbol: string; decimals: number }
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
    <section
      className="flex flex-col gap-2 rounded-lg border p-4 text-sm"
      data-testid="verify-decoded"
    >
      <h2 className="font-medium">Calldata, decoded offline</h2>
      {decoded.kind === 'empty' && <p>No calldata: a plain value transfer.</p>}
      {decoded.kind === 'raw' && (
        <p>
          Can't be decoded offline with the bundled ABIs
          {decoded.selector ? ` (selector ${decoded.selector})` : ''}. Treat it as unverified.
        </p>
      )}
      {decoded.kind === 'router' && (
        <>
          <p>A Universal Router call, decoded offline by Plain Safe's own decoder:</p>
          <RouterCommands chainId={chainId} safe={safe} router={decoded.router} offline />
        </>
      )}
      {decoded.kind === 'abi' && (
        <>
          <p>
            <span className="font-mono text-xs">{decoded.signature}</span>, with the{' '}
            {decoded.source === 'Safe' ? 'Safe ABI' : decoded.source}; not checked against the
            target's bytecode until you check against the chain.
          </p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            {decoded.args.map((a) => (
              <div key={a.name} className="contents">
                <dt className="text-muted-foreground">
                  {a.name} <span className="font-mono text-xs">{a.type}</span>
                </dt>
                <dd className="font-mono text-xs break-all">
                  {a.type === 'address' && typeof a.value === 'string' ? (
                    <AddressView chainId={chainId} address={a.value as Address} full />
                  ) : (
                    text(a.value)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {tx.value > 0n && decoded.kind !== 'empty' && (
        <p className="text-muted-foreground">
          Also sends {formatUnits(tx.value, currency.decimals)} {currency.symbol}.
        </p>
      )}
    </section>
  )
}

function OfflineSignatures({ pkg }: { pkg: VerifiedPackage }) {
  return (
    <section
      className="flex flex-col gap-1 rounded-lg border p-4 text-sm"
      data-testid="verify-signers"
    >
      <h2 className="font-medium">Signatures ({pkg.signatures.length})</h2>
      {pkg.signatures.length === 0 && <p className="text-muted-foreground">None yet.</p>}
      {pkg.signatures.map((s) => (
        <p key={s.signer}>
          Signed by <span className="font-mono">{s.signer}</span> (recovered from the signature)
        </p>
      ))}
      {pkg.rejected.map((r) => (
        <p key={r.signer} className="text-destructive">
          Rejected signature claimed by {r.signer}: {r.reason}.
        </p>
      ))}
    </section>
  )
}

/** Optional (SPEC §3.10): the authenticity check, owners and nonce, over the configured RPC. */
function ChainCheck({ parsed, signers }: { parsed: Parsed; signers: readonly Address[] }) {
  const settings = useLoadedSettings()
  const [location, navigate] = useLocation()
  const [on, setOn] = useState(false)
  const { chainId, safe, version, tx } = parsed
  const chain = settings.chains.find((c) => c.id === chainId)
  const ready = isSetupDone(settings) && !!chain
  const snapshot = useSafe(chainId, safe, on && ready, true)
  const inspection = useInspect(chainId, on && ready ? tx.to : undefined)

  if (!isSetupDone(settings))
    return (
      <p className="text-sm text-muted-foreground">
        To check this against the chain, first{' '}
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => {
            setReturnTo(location)
            navigate('/setup')
          }}
        >
          set up an RPC
        </button>
        . What you entered here isn't kept.
      </p>
    )
  if (!chain)
    return (
      <p className="text-sm text-muted-foreground">
        Chain {chainId} isn't set up. Add it in{' '}
        <Link href="/settings/rpcs" className="underline underline-offset-2">
          Settings
        </Link>{' '}
        to check this against the chain.
      </p>
    )
  if (!on)
    return (
      <Button variant="outline" className="self-start" onClick={() => setOn(true)}>
        Check against chain
      </Button>
    )

  const s = snapshot.data
  const a = s?.authenticity
  const owners = classifySigners(
    signers.map((signer) => ({ signer, kind: 'eip712' as const, data: '0x' as Hex })),
    s?.owners,
  )
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border p-4 text-sm"
      data-testid="verify-chain"
    >
      <h2 className="font-medium">Checked against {chain.name}</h2>
      {snapshot.isPending && <p className="text-muted-foreground">Reading the Safe…</p>}
      {snapshot.error && <p className="text-destructive">{describeError(snapshot.error)}</p>}
      {s && a && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <AuthenticityBadge authenticity={a} />
            <span className="text-muted-foreground">as of block {s.block.toString()}</span>
          </div>
          {a.status === 'verified' && a.version !== version && (
            <p>
              The input claims v{version}, but the code is v{a.version}. The hashes are the same for
              every version from 1.3.0 on.
            </p>
          )}
          {s.nonce !== undefined && (
            <p data-testid="verify-nonce">
              {tx.nonce < s.nonce
                ? `Nonce ${tx.nonce} was already used (the Safe is at ${s.nonce}). This transaction can't be executed.`
                : tx.nonce === s.nonce
                  ? `Nonce ${tx.nonce} is the Safe's next nonce.`
                  : `Nonce ${tx.nonce} is ${tx.nonce - s.nonce} ahead of the Safe's next nonce (${s.nonce}).`}
            </p>
          )}
          {s.threshold !== undefined && signers.length > 0 && (
            <p data-testid="verify-owners">
              {owners.owners.length} of the {signers.length} signers{' '}
              {owners.owners.length === 1 ? 'is a' : 'are'} current owner
              {owners.owners.length === 1 ? '' : 's'}; the threshold is {s.threshold.toString()}.
              {owners.nonOwners.length > 0 &&
                ` Not owners: ${owners.nonOwners.map((x) => x.signer).join(', ')}.`}
            </p>
          )}
        </>
      )}
      {inspection.error && <p className="text-destructive">{describeError(inspection.error)}</p>}
      {inspection.data && <WhatsabiChecks tx={tx} inspection={inspection.data} />}
    </section>
  )
}
