// Adding a chain from Add a Safe (SPEC §3.1 "Other chains"): only the chain ID is required.
import { useQuery } from '@tanstack/react-query'
import { Schema } from 'effect'
import { useEffect, useState } from 'react'
import type { Chain } from 'viem'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { run } from '@/effect/run'
import { defaultRpcFor } from '@/features/settings/defaults'
import { applySettingsPolicy, grantOrigin } from '@/features/settings/policy-sync'
import { testRpc } from '@/features/setup/rpc-test'
import { describeError } from '@/lib/errors'
import { originOf } from '@/netguard/guard'
import { keys } from '@/queries/keys'
import { useLoadedSettings, useSaveSettings } from '@/queries/settings'
import { ChainId, RpcUrl } from '@/schemas/common'
import type { ChainSettings } from '@/schemas/settings'

/** viem's chain list is large, so it's a lazy chunk from the app's own origin. */
async function findViemChain(id: number): Promise<Chain | undefined> {
  const all = (await import('viem/chains')) as Record<string, unknown>
  return Object.values(all).find(
    (c): c is Chain => typeof c === 'object' && c !== null && (c as Chain).id === id,
  )
}

export function AddChain({ onAdded }: { onAdded: (chainId: number) => void }) {
  const settings = useLoadedSettings()
  const save = useSaveSettings()
  const [idText, setIdText] = useState('')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [known, setKnown] = useState<Chain | undefined>()

  const id = Schema.decodeUnknownOption(ChainId)(Number(idText))
  const chainId = id._tag === 'Some' ? id.value : undefined
  const exists = chainId !== undefined && settings.chains.some((c) => c.id === chainId)

  useEffect(() => {
    setKnown(undefined)
    if (chainId === undefined) return
    setUrl(defaultRpcFor(chainId))
    let cancelled = false
    void findViemChain(chainId).then((c) => {
      if (cancelled) return
      setKnown(c)
      setName(c?.name ?? '')
      setSymbol(c?.nativeCurrency.symbol ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [chainId])

  const urlOk = Schema.decodeUnknownEither(RpcUrl)(url.trim())._tag === 'Right'
  const test = useQuery({
    queryKey: keys.rpcCaps(url.trim()),
    queryFn: () => {
      const origin = originOf(url.trim())
      if (origin) grantOrigin(origin)
      return run(testRpc({ kind: 'url', url: url.trim() }))
    },
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  const matches = test.data?.chainId === chainId
  const canAdd =
    chainId !== undefined && !exists && urlOk && matches && name.trim() && symbol.trim()

  const add = async () => {
    if (!canAdd || chainId === undefined) return
    const chain: ChainSettings = {
      id: chainId,
      name: name.trim(),
      nativeCurrency: known?.nativeCurrency ?? {
        name: symbol.trim(),
        symbol: symbol.trim(),
        decimals: 18,
      },
      rpc: { _tag: 'url', url: url.trim() },
      ...(known?.blockExplorers?.default.url ? { explorer: known.blockExplorers.default.url } : {}),
      ...(known?.contracts?.multicall3?.address
        ? { multicall3: known.contracts.multicall3.address }
        : {}),
    }
    const next = { ...settings, chains: [...settings.chains, chain] }
    await save.mutateAsync(next)
    applySettingsPolicy(next)
    onAdded(chainId)
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="chain-id">Chain ID</Label>
        <Input
          id="chain-id"
          inputMode="numeric"
          value={idText}
          onChange={(e) => setIdText(e.target.value.trim())}
          placeholder="e.g. 8453"
        />
        {exists && <p className="text-sm text-muted-foreground">This chain is already set up.</p>}
      </div>
      {chainId !== undefined && !exists && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chain-name">Name</Label>
              <Input
                id="chain-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!!known}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chain-symbol">Currency symbol</Label>
              <Input
                id="chain-symbol"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                disabled={!!known}
              />
            </div>
          </div>
          {!known && (
            <p className="text-sm text-muted-foreground">
              This chain isn't in viem's list, so enter its name and currency. Reads use deployless
              multicall.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chain-rpc">RPC URL</Label>
            <Input
              id="chain-rpc"
              className="font-mono text-sm"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              spellCheck={false}
            />
            <p className="text-sm text-muted-foreground">
              This is a public endpoint. For privacy and reliability, use your own RPC (your node or
              a provider you trust).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={!urlOk || test.isFetching}
              onClick={() => void test.refetch()}
            >
              {test.isFetching ? 'Testing…' : 'Test'}
            </Button>
            {test.error && !test.isFetching && (
              <span className="text-sm text-destructive">{describeError(test.error)}</span>
            )}
            {test.data && !test.isFetching && (
              <span
                className={
                  matches
                    ? 'text-sm text-emerald-700 dark:text-emerald-400'
                    : 'text-sm text-destructive'
                }
              >
                {matches
                  ? 'Chain ID matches.'
                  : `This RPC is on chain ${test.data.chainId}, not ${chainId}.`}
              </span>
            )}
            <Button
              size="sm"
              className="ml-auto"
              disabled={!canAdd || save.isPending}
              onClick={() => void add()}
            >
              Add chain
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
