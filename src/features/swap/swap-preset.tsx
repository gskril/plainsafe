// The Swap form (SPEC §3.13): sell a held token or ETH for any listed token, quoted onchain
// across Uniswap v3 and v4. Reports the Safe transaction to the builder, which reviews it.
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { Address } from 'viem'
import { AddressField, AmountField, parseAmount } from '@/components/inputs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ETH,
  isEth,
  minimumOut,
  type Route,
  type SwapIntent,
  type SwapPlan,
  type UniswapContracts,
} from '@/core/uniswap'
import { run } from '@/effect/run'
import { formatAmount } from '@/features/balances/format'
import { type PresetProps, useReport } from '@/features/builder/presets'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { describeError } from '@/lib/errors'
import { shortAddress } from '@/lib/format'
import { useTokenMeta } from '@/queries/contracts'
import { useResolvedAddress } from '@/queries/ens'
import { useSwapContracts, useSwapQuote } from '@/queries/swap'
import { useBalances, useTokenUniverse } from '@/queries/tokens'
import { buildSwap, type TwapCheck } from './program'

interface Coin {
  readonly address: Address
  readonly symbol: string
  readonly decimals: number
}

const ETH_COIN: Coin = { address: ETH, symbol: 'ETH', decimals: 18 }
const OTHER = 'other'

/** Symbols for the addresses a route passes through. */
export function useSymbols(chainId: number, contracts: UniswapContracts | null | undefined) {
  const universe = useTokenUniverse(chainId)
  return (a: Address) => {
    if (isEth(a)) return 'ETH'
    const t = universe?.find((x) => x.address.toLowerCase() === a.toLowerCase())
    if (t) return t.symbol
    if (contracts && a.toLowerCase() === contracts.weth.toLowerCase()) return 'WETH'
    if (contracts && a.toLowerCase() === contracts.usdc.toLowerCase()) return 'USDC'
    return shortAddress(a)
  }
}

/** "v3 · USDC → WETH (0.05%) → DAI (0.3%)" */
export const routeText = (r: Route, symbol: (a: Address) => string) =>
  `${r.protocol} · ${r.path
    .map((a, i) => (i === 0 ? symbol(a) : `${symbol(a)} (${(r.fees[i - 1] ?? 0) / 10_000}%)`))
    .join(' → ')}`

export function SwapPreset({ safe, onResult }: PresetProps) {
  const contracts = useSwapContracts(safe.chainId)
  if (contracts.isPending) return <p className="text-muted-foreground">Checking Uniswap…</p>
  if (contracts.error) return <p className="text-destructive">{describeError(contracts.error)}</p>
  if (!contracts.data)
    return (
      <p className="text-muted-foreground">
        Swap isn't available on this chain: Uniswap's contracts aren't deployed here.
      </p>
    )
  return <SwapForm safe={safe} contracts={contracts.data} onResult={onResult} />
}

function SwapForm({ safe, contracts, onResult }: PresetProps & { contracts: UniswapContracts }) {
  const universe = useTokenUniverse(safe.chainId)
  const balances = useBalances(safe.chainId, safe.address, true)
  const symbol = useSymbols(safe.chainId, contracts)
  const [sellChoice, setSellChoice] = useState<string>(ETH)
  const [buyChoice, setBuyChoice] = useState<string>('')
  const [buyText, setBuyText] = useState('')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState('1')
  const [hours, setHours] = useState('24')

  // Sell: ETH and every token the Safe holds
  const held = (balances.data?.tokens ?? []).filter((t) => t.balance > 0n)
  const sell: Coin | undefined =
    sellChoice === ETH
      ? ETH_COIN
      : held.find((t) => t.token.address.toLowerCase() === sellChoice.toLowerCase())?.token
  const sellBalance =
    sellChoice === ETH
      ? safe.balance
      : held.find((t) => t.token.address.toLowerCase() === sellChoice.toLowerCase())?.balance

  // Buy: ETH, any listed token, or a token by address
  const other = useResolvedAddress(safe.chainId, buyText).address
  const listedOther = other
    ? universe?.find((t) => t.address.toLowerCase() === other.toLowerCase())
    : undefined
  const meta = useTokenMeta(safe.chainId, buyChoice === OTHER && !listedOther ? other : undefined)
  const buy: Coin | undefined =
    buyChoice === ETH
      ? ETH_COIN
      : buyChoice === OTHER
        ? (listedOther ?? (meta.data && other ? { ...meta.data, address: other } : undefined))
        : universe?.find((t) => t.address.toLowerCase() === buyChoice.toLowerCase())

  const amountIn = sell ? parseAmount(amount, sell.decimals) : undefined
  const slippageBps = /^\d+(\.\d{1,2})?$/.test(slippage.trim())
    ? Math.round(Number(slippage) * 100)
    : undefined
  const deadlineHours = /^\d+$/.test(hours.trim()) ? Number(hours) : undefined
  const slippageOk = slippageBps !== undefined && slippageBps > 0 && slippageBps < 5000
  const deadlineOk = deadlineHours !== undefined && deadlineHours >= 1 && deadlineHours <= 24 * 30

  const intent: SwapIntent | undefined =
    sell && buy && amountIn && amountIn > 0n && sell.address !== buy.address
      ? { sell: sell.address, buy: buy.address, amountIn }
      : undefined
  const quote = useSwapQuote(safe.chainId, contracts, intent)
  const best = quote.data?.best

  // The deadline counts from when the quote was taken
  const quotedAt = quote.dataUpdatedAt
  const plan: SwapPlan | undefined = useMemo(
    () =>
      intent && best && slippageOk && deadlineOk && slippageBps !== undefined
        ? {
            intent,
            route: best.route,
            minOut: minimumOut(best.amountOut, slippageBps),
            recipient: safe.address,
            deadline: BigInt(Math.floor(quotedAt / 1000) + (deadlineHours ?? 24) * 3600),
          }
        : undefined,
    [intent, best, slippageOk, deadlineOk, slippageBps, deadlineHours, quotedAt, safe.address],
  )
  const built = useBuiltSwap(safe, contracts, plan)
  const result =
    plan && built.data && sell && buy
      ? {
          call: built.data,
          description: `Swap ${formatAmount(plan.intent.amountIn, sell.decimals)} ${sell.symbol} for at least ${formatAmount(plan.minOut, buy.decimals)} ${buy.symbol} on Uniswap ${plan.route.protocol}`,
        }
      : undefined
  useReport(result, onResult)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sell">Sell</Label>
          <select
            id="sell"
            value={sellChoice}
            onChange={(e) => setSellChoice(e.target.value)}
            className="h-9 rounded-lg border bg-background px-2 text-sm"
          >
            <option value={ETH}>ETH · {formatAmount(safe.balance, 18)}</option>
            {held.map(({ token, balance }) => (
              <option key={token.address} value={token.address}>
                {token.symbol} · {shortAddress(token.address)} ·{' '}
                {formatAmount(balance, token.decimals)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="buy">Buy</Label>
          <select
            id="buy"
            value={buyChoice}
            onChange={(e) => setBuyChoice(e.target.value)}
            className="h-9 rounded-lg border bg-background px-2 text-sm"
          >
            <option value="">Choose a token…</option>
            <option value={ETH}>ETH</option>
            {(universe ?? []).map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol} · {shortAddress(t.address)} · from {t.source}
              </option>
            ))}
            <option value={OTHER}>Other token (by address)…</option>
          </select>
        </div>
      </div>
      {buyChoice === OTHER && (
        <AddressField
          label="Token to buy"
          chainId={safe.chainId}
          value={buyText}
          onChange={setBuyText}
        />
      )}
      {meta.error && <p className="text-sm text-destructive">{describeError(meta.error)}</p>}
      {buyChoice === OTHER && buy && !listedOther && (
        <p className="text-sm text-muted-foreground">
          {buy.symbol}, {buy.decimals} decimals, from the token contract (not in your lists). It is
          identified by its address, not its symbol.
        </p>
      )}
      {sell && (
        <AmountField
          label="Amount to sell"
          value={amount}
          onChange={setAmount}
          decimals={sell.decimals}
          symbol={sell.symbol}
          max={sellBalance}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slippage">Slippage (%)</Label>
          <Input
            id="slippage"
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            inputMode="decimal"
            className="w-32 font-mono"
          />
          {!slippageOk && (
            <p className="text-sm text-destructive">Enter a percentage between 0.01 and 49.99.</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deadline">Deadline (hours)</Label>
          <Input
            id="deadline"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            inputMode="numeric"
            className="w-32 font-mono"
          />
          {!deadlineOk && (
            <p className="text-sm text-destructive">Enter whole hours, from 1 to 720.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Signatures take time, so the default is a day.
          </p>
        </div>
      </div>
      {sell && buy && sell.address === buy.address && (
        <p className="text-sm text-destructive">Choose two different tokens.</p>
      )}
      {intent && (
        <QuotePanel
          quote={quote}
          plan={plan}
          buy={buy}
          symbol={symbol}
          building={built.isPending && !!plan}
          buildError={built.error}
          noBatch={built.data === null}
        />
      )}
    </div>
  )
}

function useBuiltSwap(safe: SafeSnapshot, contracts: UniswapContracts, plan: SwapPlan | undefined) {
  const version = safe.authenticity.status === 'verified' ? safe.authenticity.version : ''
  const key = plan
    ? JSON.stringify(plan, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
    : 'none'
  return useQuery({
    queryKey: ['swap-build', safe.chainId, safe.address.toLowerCase(), key],
    queryFn: () =>
      plan ? run(buildSwap(safe.chainId, version, contracts, plan)).then((c) => c ?? null) : null,
    enabled: !!plan,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

function QuotePanel(props: {
  quote: ReturnType<typeof useSwapQuote>
  plan: SwapPlan | undefined
  buy: Coin | undefined
  symbol: (a: Address) => string
  building: boolean
  buildError: Error | null
  noBatch: boolean
}) {
  const { quote, plan, buy, symbol } = props
  if (quote.isPending) return <p className="text-sm text-muted-foreground">Getting quotes…</p>
  if (quote.error) return <p className="text-sm text-destructive">{describeError(quote.error)}</p>
  const q = quote.data
  if (!q || !buy)
    return (
      <p className="rounded-lg border p-3 text-sm" data-testid="no-route">
        No Uniswap route found for this pair and amount.
      </p>
    )
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm" data-testid="swap-quote">
      <p className="text-base font-medium">
        ≈ {formatAmount(q.best.amountOut, buy.decimals)} {buy.symbol}
      </p>
      <p>
        Route: <span className="font-mono">{routeText(q.best.route, symbol)}</span>
      </p>
      {plan && (
        <p>
          Minimum received: {formatAmount(plan.minOut, buy.decimals)} {buy.symbol}, until{' '}
          {new Date(Number(plan.deadline) * 1000).toLocaleString()}
        </p>
      )}
      <p className="text-muted-foreground">
        Best of {q.quoted} quoted routes ({q.asked} tried) at block {q.block.toString()}, from
        Uniswap's quoter contracts through your RPC.
      </p>
      <TwapLine twap={q.twap} />
      {props.building && <p className="text-muted-foreground">Preparing the transaction…</p>}
      {props.buildError && <p className="text-destructive">{describeError(props.buildError)}</p>}
      {props.noBatch && (
        <p className="text-destructive">
          There's no verified MultiSendCallOnly on this chain, so this swap can't be batched.
        </p>
      )}
    </div>
  )
}

function TwapLine({ twap }: { twap: TwapCheck }) {
  if (twap.kind === 'unavailable')
    return <p className="text-muted-foreground">No TWAP check for this route.</p>
  const pct = `${(Math.abs(twap.shortfall) * 100).toFixed(2)}%`
  if (twap.kind === 'worse')
    return (
      <p
        className="rounded-md border border-orange-300 bg-orange-50 p-2 text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200"
        data-testid="twap-warning"
      >
        This quote is {pct} worse than Uniswap's 30-minute average price implies. The pool may be
        thin or its price may have been moved. Consider a smaller amount or waiting.
      </p>
    )
  return (
    <p className="text-muted-foreground" data-testid="twap-ok">
      Within 2% of Uniswap's 30-minute average price ({pct}{' '}
      {twap.shortfall > 0 ? 'worse' : 'better'}).
    </p>
  )
}
