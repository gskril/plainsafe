// Settings → Token lists and My tokens (SPEC §3.12, §10).
import { Either } from 'effect'
import { Download, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { AddressField, parseAddressInput } from '@/components/inputs'
import { TokenMonogram } from '@/components/token-monogram'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { exportTokenList, parseTokenList } from '@/core/tokenlist'
import { run } from '@/effect/run'
import { BUILT_IN_ID } from '@/features/tokens/store'
import { tokenMeta } from '@/features/tokens/token-meta'
import { describeError } from '@/lib/errors'
import { shortAddress } from '@/lib/format'
import { netguard, originOf } from '@/netguard'
import { useLoadedSettings, useSaveSettings } from '@/queries/settings'
import { useMyTokens, useTokenLists, useTokenMutations } from '@/queries/tokens'
import { applySettingsPolicy, grantOrigin, revokeGrant } from './policy-sync'

export function TokensSettings() {
  return (
    <div className="flex flex-col gap-8">
      <TokenLists />
      <MyTokens />
    </div>
  )
}

function TokenLists() {
  const lists = useTokenLists()
  const m = useTokenMutations()
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Token lists</h2>
      <p className="text-sm text-muted-foreground">
        Lists apply to every Safe on a matching chain. Tokens are identified by address, never by
        symbol. Logos are never loaded.
      </p>
      <ul className="flex flex-col divide-y rounded-lg border" data-testid="token-lists">
        {lists.data?.lists.map((l) => (
          <li key={l.id} className="flex items-center gap-3 p-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{l.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {l.tokens.length} tokens · {l.source}
              </span>
            </div>
            <Switch
              checked={l.enabled}
              aria-label={`Use ${l.name}`}
              onCheckedChange={(enabled) => m.setEnabled.mutate({ id: l.id, enabled })}
            />
            {l.id !== BUILT_IN_ID && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${l.name}`}
                onClick={() => m.deleteList.mutate(l.id)}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {lists.data && lists.data.invalid.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {lists.data.invalid.length} stored list(s) failed validation and were not used.
        </p>
      )}
      <ImportList />
    </section>
  )
}

function ImportList() {
  const settings = useLoadedSettings()
  const saveSettings = useSaveSettings()
  const m = useTokenMutations()
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [message, setMessage] = useState<string>()
  const [askOrigin, setAskOrigin] = useState<string>()

  const store = async (json: unknown, source: string, id: string) => {
    const parsed = parseTokenList(json)
    if (Either.isLeft(parsed)) return setMessage(parsed.left)
    await m.saveList.mutateAsync({
      id,
      name: parsed.right.name,
      source,
      enabled: true,
      tokens: parsed.right.tokens,
      importedAt: new Date().toISOString(),
    })
    setMessage(
      `Imported ${parsed.right.tokens.length} tokens from “${parsed.right.name}”${parsed.right.skipped ? `; skipped ${parsed.right.skipped} that are malformed or not EVM tokens` : ''}.`,
    )
  }
  const fromText = async (t: string, source: string) => {
    try {
      await store(JSON.parse(t), source, `${source}:${Date.now()}`)
    } catch {
      setMessage('Not valid JSON.')
    }
  }
  const fetchList = async (u: string) => {
    try {
      const res = await netguard.fetchFor('tokenlist')(u)
      if (!res.ok) return setMessage(`${new URL(u).host} answered HTTP ${res.status}.`)
      await store(await res.json(), u, u)
    } catch (e) {
      setMessage(describeError(e))
    }
  }
  const startUrl = async () => {
    setMessage(undefined)
    const origin = originOf(url.trim())
    if (!origin || !url.trim().startsWith('https://')) return setMessage('Enter an https:// URL.')
    if (settings.capabilities.tokenListOrigins.includes(origin)) return fetchList(url.trim())
    setAskOrigin(origin)
  }
  const once = async () => {
    if (!askOrigin) return
    grantOrigin(askOrigin)
    try {
      await fetchList(url.trim())
    } finally {
      revokeGrant(askOrigin)
      setAskOrigin(undefined)
    }
  }
  const always = async () => {
    if (!askOrigin) return
    const next = {
      ...settings,
      capabilities: {
        ...settings.capabilities,
        tokenListOrigins: [...settings.capabilities.tokenListOrigins, askOrigin],
      },
    }
    await saveSettings.mutateAsync(next)
    applySettingsPolicy(next)
    setAskOrigin(undefined)
    await fetchList(url.trim())
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <h3 className="font-medium">Import a list</h3>
      <Label htmlFor="list-json">Paste a Uniswap-format token list</Label>
      <textarea
        id="list-json"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="rounded-lg border bg-background p-2 font-mono text-xs"
        spellCheck={false}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!text.trim()} onClick={() => void fromText(text, 'pasted')}>
          Import pasted list
        </Button>
        <label className="text-sm text-muted-foreground">
          or a file{' '}
          <input
            type="file"
            accept="application/json,.json"
            className="text-sm"
            onChange={(e) => e.target.files?.[0]?.text().then((t) => fromText(t, 'file'))}
          />
        </label>
      </div>
      <Label htmlFor="list-url">Or by URL</Label>
      <div className="flex gap-2">
        <Input
          id="list-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://tokens.uniswap.org"
          className="font-mono text-sm"
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void startUrl()}
          disabled={!url.trim()}
        >
          Fetch
        </Button>
      </div>
      {askOrigin && (
        <div
          className="flex flex-col gap-2 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/40"
          data-testid="list-consent"
        >
          <p>
            This list is at <span className="font-mono">{new URL(askOrigin).host}</span>. Fetching
            it contacts that host. Fetch it once, or always allow it?
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void once()}>
              Fetch once
            </Button>
            <Button size="sm" variant="outline" onClick={() => void always()}>
              Always allow
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAskOrigin(undefined)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {message && (
        <p className="text-sm" data-testid="list-message">
          {message}
        </p>
      )}
    </div>
  )
}

function MyTokens() {
  const settings = useLoadedSettings()
  const mine = useMyTokens()
  const m = useTokenMutations()
  const [chainId, setChainId] = useState(settings.chains[0]?.id ?? 1)
  const [addressText, setAddressText] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const address = parseAddressInput(addressText)

  const add = async () => {
    if (!address) return
    setError(undefined)
    setBusy(true)
    try {
      const meta = await run(tokenMeta(chainId, address))
      await m.addMine.mutateAsync({
        chainId,
        address: meta.address,
        symbol: meta.symbol,
        name: meta.name ?? '',
        decimals: meta.decimals,
        addedAt: new Date().toISOString(),
      })
      setAddressText('')
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }
  const exportList = () => {
    const list = exportTokenList('My tokens', mine.data?.tokens ?? [])
    const a = document.createElement('a')
    a.href = URL.createObjectURL(
      new Blob([`${JSON.stringify(list, null, 2)}\n`], { type: 'application/json' }),
    )
    a.download = 'plainsafe-my-tokens.tokenlist.json'
    a.click()
  }
  const chainName = (id: number) => settings.chains.find((c) => c.id === id)?.name ?? `Chain ${id}`
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">My tokens</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={exportList}
          disabled={!mine.data?.tokens.length}
        >
          <Download /> Export as a token list
        </Button>
      </div>
      <ul className="flex flex-col divide-y rounded-lg border empty:hidden">
        {mine.data?.tokens.map((t) => (
          <li key={`${t.chainId}:${t.address}`} className="flex items-center gap-3 p-3">
            <TokenMonogram symbol={t.symbol} />
            <div className="flex flex-1 flex-col">
              <span className="font-medium">{t.symbol}</span>
              <span className="text-xs text-muted-foreground">
                {chainName(t.chainId)} · {shortAddress(t.address)} · {t.decimals} decimals
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${t.symbol}`}
              onClick={() => m.removeMine.mutate({ chainId: t.chainId, address: t.address })}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <h3 className="font-medium">Add a token by address</h3>
        <select
          aria-label="Chain"
          value={chainId}
          onChange={(e) => setChainId(Number(e.target.value))}
          className="h-9 rounded-lg border bg-background px-2 text-sm"
        >
          {settings.chains.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <AddressField
          label="Token contract"
          chainId={chainId}
          value={addressText}
          onChange={setAddressText}
        />
        <p className="text-xs text-muted-foreground">
          Symbol and decimals are read from the token contract over your RPC.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          size="sm"
          className="self-start"
          disabled={!address || busy}
          onClick={() => void add()}
        >
          Add token
        </Button>
      </div>
    </section>
  )
}
