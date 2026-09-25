// wagmi is used only for the wallet (SPEC §8.3): injected + EIP-6963 discovery, nothing else.
import { type Chain, defineChain } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { createConfig, http, injected, type Transport, unstable_connector } from 'wagmi'
import { netguard } from '@/netguard'
import type { ChainSettings } from '@/schemas/settings'

const KNOWN: Record<number, Chain> = { [mainnet.id]: mainnet, [sepolia.id]: sepolia }

export function toViemChain(c: ChainSettings): Chain {
  const known = KNOWN[c.id]
  const rpcUrl = c.rpc._tag === 'url' ? c.rpc.url : undefined
  const base =
    known ??
    defineChain({
      id: c.id,
      name: c.name,
      nativeCurrency: c.nativeCurrency,
      rpcUrls: { default: { http: [] } },
    })
  return {
    ...base,
    name: c.name,
    rpcUrls: { default: { http: rpcUrl ? [rpcUrl] : [...base.rpcUrls.default.http] } },
    ...(c.explorer ? { blockExplorers: { default: { name: 'Explorer', url: c.explorer } } } : {}),
  }
}

export function makeWagmiConfig(chains: readonly ChainSettings[]) {
  const viemChains = (chains.length ? chains : []).map(toViemChain)
  const all = (viemChains.length ? viemChains : [mainnet]) as [Chain, ...Chain[]]
  const transports: Record<number, Transport> = {}
  for (const c of chains) {
    transports[c.id] =
      c.rpc._tag === 'url'
        ? http(c.rpc.url, { fetchFn: netguard.fetchFor(`wagmi:${c.id}`) })
        : unstable_connector(injected)
  }
  if (!chains.length) transports[mainnet.id] = unstable_connector(injected)
  return createConfig({
    chains: all,
    connectors: [injected()],
    multiInjectedProviderDiscovery: true,
    // wagmi's default storage is the browser's Web Storage, which SPEC §9.5 forbids.
    storage: null,
    transports,
  })
}
