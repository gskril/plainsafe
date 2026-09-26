import { mainnet, sepolia } from 'viem/chains'
import type { ChainSettings, Settings } from '@/schemas/settings'

// SPEC §3.1: prefilled, editable RPCs. Public endpoints; the UI recommends your own.
export const DEFAULT_MAINNET_RPC = 'https://rpc.mevblocker.io'
// SPEC §8.4: MEV Blocker for Mainnet, evm.stupidtech.net for every other chain.
export const defaultRpcFor = (chainId: number) =>
  chainId === mainnet.id ? DEFAULT_MAINNET_RPC : `https://evm.stupidtech.net/v1/${chainId}`

// SPEC §7.2: the auditor in the registry's auditors/ folder.
export const DEFAULT_AUDITOR = 'eip155-1-0x3846c3A30E62075Fa916216b35EF04B8F53931f6'

export const defaultChains: readonly ChainSettings[] = [
  {
    id: mainnet.id,
    name: 'Ethereum',
    nativeCurrency: mainnet.nativeCurrency,
    rpc: { _tag: 'url', url: DEFAULT_MAINNET_RPC },
    explorer: mainnet.blockExplorers.default.url,
  },
  {
    id: sepolia.id,
    name: 'Sepolia',
    nativeCurrency: sepolia.nativeCurrency,
    rpc: { _tag: 'url', url: defaultRpcFor(sepolia.id) },
    explorer: sepolia.blockExplorers.default.url,
  },
]

export const defaultSettings: Settings = {
  version: 1,
  setupDone: false,
  chains: defaultChains,
  capabilities: {
    tokenListOrigins: [],
    clearSigningDescriptors: false,
    sourcify: false,
    signatureDatabase: false,
    ccipRead: false,
  },
  trustedAuditors: [DEFAULT_AUDITOR],
  currency: 'USD',
}
