// First-run setup (SPEC §3.1). No request leaves the browser until the user presses Test or
// finishes setup.
import { useQuery } from '@tanstack/react-query'
import { Schema } from 'effect'
import { CheckCircle2, ChevronDown, CircleAlert, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { EIP1193Provider } from 'viem'
import { useConnection, useSwitchChain } from 'wagmi'
import { useLocation } from 'wouter'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { run } from '@/effect/run'
import { CAPABILITIES } from '@/features/settings/capabilities'
import { DEFAULT_MAINNET_RPC, defaultRpcFor } from '@/features/settings/defaults'
import { applySettingsPolicy, grantOrigin } from '@/features/settings/policy-sync'
import { describeError } from '@/lib/errors'
import { originOf } from '@/netguard/guard'
import { keys } from '@/queries/keys'
import { useSaveSettings } from '@/queries/settings'
import { RpcUrl } from '@/schemas/common'
import type { Capabilities, ChainSettings, Settings } from '@/schemas/settings'
import { requestPersistence } from '@/storage/db'
import { markSetupCompleted, takeReturnTo } from './return-to'
import { type RpcTestResult, testRpc } from './rpc-test'

interface Draft {
  readonly chain: ChainSettings
  readonly useWallet: boolean
  readonly url: string
}

const draftOf = (chain: ChainSettings): Draft => ({
  chain,
  useWallet: chain.rpc._tag === 'wallet',
  url:
    chain.rpc._tag === 'url'
      ? chain.rpc.url
      : chain.id === 1
        ? DEFAULT_MAINNET_RPC
        : defaultRpcFor(chain.id),
})

const urlProblem = (url: string) => {
  const r = Schema.decodeUnknownEither(RpcUrl)(url.trim())
  return r._tag === 'Left'
    ? 'Use an https:// URL (http:// is allowed only for localhost)'
    : undefined
}

export function SetupScreen({ settings }: { settings: Settings }) {
  const [drafts, setDrafts] = useState(() => settings.chains.map(draftOf))
  const [caps, setCaps] = useState<Capabilities>(settings.capabilities)
  const save = useSaveSettings()
  const [, navigate] = useLocation()
  const invalid = drafts.some((d) => !d.useWallet && urlProblem(d.url))

  const onContinue = async () => {
    const chains = drafts.map(
      (d): ChainSettings => ({
        ...d.chain,
        rpc: d.useWallet ? { _tag: 'wallet' } : { _tag: 'url', url: d.url.trim() },
      }),
    )
    const next: Settings = { ...settings, chains, capabilities: caps, setupDone: true }
    await save.mutateAsync(next)
    applySettingsPolicy(next)
    markSetupCompleted()
    void requestPersistence()
    navigate(takeReturnTo() ?? '/add', { replace: true })
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Set up Plain Safe</h1>
        <p className="text-lg" data-testid="promise">
          Plain Safe talks to one RPC you choose. Nothing else, unless you turn it on.
        </p>
      </div>

      {drafts.map((draft, i) => (
        <ChainRpcCard
          key={draft.chain.id}
          draft={draft}
          onChange={(next) => setDrafts((ds) => ds.map((d, j) => (j === i ? next : d)))}
        />
      ))}
      <p className="text-sm text-muted-foreground">
        These are public endpoints. For privacy and reliability, use your own RPC (your node or a
        provider you trust).
      </p>

      <OptionalNetworkAccess caps={caps} onChange={setCaps} />

      <div className="flex flex-col items-end gap-2">
        {save.error && (
          <p className="text-sm text-destructive">Couldn't save settings: {String(save.error)}</p>
        )}
        <Button size="lg" disabled={invalid || save.isPending} onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  )
}

function ChainRpcCard({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const { chain } = draft
  const problem = draft.useWallet ? undefined : urlProblem(draft.url)
  const id = `rpc-${chain.id}`
  return (
    <Card>
      <CardHeader>
        <CardTitle>{chain.name}</CardTitle>
        <CardDescription>Chain ID {chain.id}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <RadioGroup
          value={draft.useWallet ? 'wallet' : 'url'}
          onValueChange={(v) => onChange({ ...draft, useWallet: v === 'wallet' })}
          className="flex flex-wrap gap-4"
        >
          <Label className="flex items-center gap-2 font-normal">
            <RadioGroupItem value="url" /> RPC URL
          </Label>
          <Label className="flex items-center gap-2 font-normal">
            <RadioGroupItem value="wallet" /> Use my wallet's RPC
          </Label>
        </RadioGroup>
        {draft.useWallet ? (
          <p className="text-sm text-muted-foreground">
            Reads go through your browser wallet, so this page makes no requests for {chain.name}.
            Your wallet must be on {chain.name} while you use it.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id}>RPC URL</Label>
            <Input
              id={id}
              value={draft.url}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!!problem}
              onChange={(e) => onChange({ ...draft, url: e.target.value })}
              className="font-mono text-sm"
            />
            {problem && <p className="text-sm text-destructive">{problem}</p>}
          </div>
        )}
        {draft.useWallet ? (
          <WalletRpcTest chain={chain} />
        ) : (
          !problem && <UrlRpcTest chain={chain} url={draft.url.trim()} />
        )}
      </CardContent>
    </Card>
  )
}

function UrlRpcTest({ chain, url }: { chain: ChainSettings; url: string }) {
  const test = useQuery({
    queryKey: keys.rpcCaps(url),
    queryFn: () => {
      // Pressing Test is consent for this one origin, for this session (SPEC §3.1).
      const origin = originOf(url)
      if (origin) grantOrigin(origin)
      return run(testRpc({ kind: 'url', url }))
    },
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  return (
    <TestRow
      chain={chain}
      onTest={() => void test.refetch()}
      pending={test.isFetching}
      result={test.data}
      error={test.error}
    />
  )
}

function WalletRpcTest({ chain }: { chain: ChainSettings }) {
  const connection = useConnection()
  const switchChain = useSwitchChain()
  const test = useQuery({
    queryKey: keys.rpcCaps(`wallet:${chain.id}`),
    queryFn: async () => {
      if (connection.status !== 'connected')
        throw new Error('Connect your wallet first (top right).')
      const provider = (await connection.connector.getProvider()) as EIP1193Provider
      return run(testRpc({ kind: 'wallet', provider }))
    },
    enabled: false,
    staleTime: 0,
    retry: false,
  })
  const wrongChain = test.data && test.data.chainId !== chain.id
  return (
    <div className="flex flex-col gap-2">
      <TestRow
        chain={chain}
        onTest={() => void test.refetch()}
        pending={test.isFetching}
        result={test.data}
        error={test.error}
        subject="Your wallet"
      />
      {wrongChain && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={switchChain.isPending}
          onClick={() =>
            switchChain.mutate({ chainId: chain.id }, { onSuccess: () => void test.refetch() })
          }
        >
          Switch wallet to {chain.name}
        </Button>
      )}
    </div>
  )
}

function TestRow(props: {
  chain: ChainSettings
  onTest: () => void
  pending: boolean
  result?: RpcTestResult
  error: Error | null
  subject?: string
}) {
  const { chain, result, error } = props
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <Button variant="secondary" size="sm" onClick={props.onTest} disabled={props.pending}>
        {props.pending ? 'Testing…' : 'Test'}
      </Button>
      <div className="flex flex-col gap-1 text-sm" data-testid={`test-result-${chain.id}`}>
        {error && !props.pending && <Line tone="bad">{describeError(error)}</Line>}
        {result && !props.pending && result.chainId !== chain.id && (
          <Line tone="bad">
            {props.subject ?? 'This RPC'} is on chain {result.chainId}, not {chain.name} ({chain.id}
            ).
          </Line>
        )}
        {result && !props.pending && result.chainId === chain.id && (
          <>
            <Line tone="good">Connected to {chain.name} (chain ID matches).</Line>
            {result.simulation.status === 'supported' && (
              <Line tone="good">Supports transaction simulation (eth_simulateV1).</Line>
            )}
            {result.simulation.status === 'unsupported' && (
              <Line tone="warn">
                This RPC can't simulate transactions. Reviews will show a warning instead of a
                simulation.
              </Line>
            )}
            {result.simulation.status === 'temporary' && (
              <Line tone="warn">
                Couldn't check simulation support right now ({result.simulation.reason}). It will be
                checked again when needed.
              </Line>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Line({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: React.ReactNode }) {
  const Icon = tone === 'good' ? CheckCircle2 : tone === 'warn' ? TriangleAlert : CircleAlert
  const color = {
    good: 'text-emerald-700 dark:text-emerald-400',
    warn: 'text-amber-700 dark:text-amber-400',
    bad: 'text-destructive',
  }[tone]
  return (
    <p className={`flex items-start gap-1.5 ${color}`}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function OptionalNetworkAccess(props: { caps: Capabilities; onChange: (c: Capabilities) => void }) {
  const { caps, onChange } = props
  return (
    <Collapsible className="rounded-lg border">
      <CollapsibleTrigger className="group flex w-full items-center justify-between p-4 text-left font-medium">
        Optional network access
        <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 px-4 pb-4">
        <p className="text-sm text-muted-foreground">
          All off by default. Each one lets Plain Safe contact exactly the host shown. You can
          change these later in Settings.
        </p>
        {CAPABILITIES.map((cap) => (
          <div key={cap.key} className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor={`cap-${cap.key}`}>{cap.label}</Label>
              <span className="text-sm text-muted-foreground">{cap.usedFor}</span>
              <span className="font-mono text-xs text-muted-foreground">{cap.hostLabel}</span>
            </div>
            <Switch
              id={`cap-${cap.key}`}
              checked={caps[cap.key]}
              onCheckedChange={(on) => onChange({ ...caps, [cap.key]: on })}
            />
          </div>
        ))}
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Token lists by URL or ENS</span>
          <span className="text-sm text-muted-foreground">
            Pasting or uploading a list needs nothing. When you import one by URL, Plain Safe asks
            before contacting that host.
          </span>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
