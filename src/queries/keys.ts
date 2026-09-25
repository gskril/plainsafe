// Every query key comes from here (SPEC §9.3). Block numbers are strings: query keys are hashed
// with JSON.stringify, which cannot serialize bigint.
import type { Address, Hex } from 'viem'

const block = (n?: bigint) => (n === undefined ? [] : [n.toString()])

export const keys = {
  /** User data from IndexedDB (not chain state). */
  settings: () => ['settings'] as const,
  mySafes: () => ['user', 'safes'] as const,
  recent: () => ['user', 'recent'] as const,
  addressBook: () => ['user', 'addressbook'] as const,
  packages: (chainId: number, safe: Address) =>
    ['user', 'packages', chainId, safe.toLowerCase()] as const,
  package: (chainId: number, safe: Address, safeTxHash: Hex) =>
    ['user', 'packages', chainId, safe.toLowerCase(), safeTxHash.toLowerCase()] as const,
  savedAbi: (chainId: number, codeHash: Hex) =>
    ['user', 'abi', chainId, codeHash.toLowerCase()] as const,
  rpcCaps: (rpcUrl: string) => ['rpc-caps', rpcUrl] as const,
  safe: (chainId: number, address: Address, blockNumber?: bigint) =>
    ['safe', chainId, address.toLowerCase(), ...block(blockNumber)] as const,
  balances: (chainId: number, safe: Address, tokenSetHash: string) =>
    ['balances', chainId, safe.toLowerCase(), tokenSetHash] as const,
  abi: (chainId: number, address: Address) => ['abi', chainId, address.toLowerCase()] as const,
  whatsabi: (chainId: number, address: Address) =>
    ['whatsabi', chainId, address.toLowerCase()] as const,
  render: (chainId: number, safeTxHash: Hex) => ['render', chainId, safeTxHash] as const,
  simulation: (chainId: number, safeTxHash: Hex, blockNumber: bigint) =>
    ['simulation', chainId, safeTxHash, blockNumber.toString()] as const,
  /** Is the price aggregator deployed on this chain (SPEC §10.1)? */
  aggregator: (chainId: number) => ['aggregator', chainId] as const,
  ethFiat: (currency: string) => ['eth-fiat', 1, currency] as const,
  tokenLists: () => ['user', 'tokenlists'] as const,
  myTokens: () => ['user', 'mytokens'] as const,
  tokenMeta: (chainId: number, token: Address) =>
    ['token-meta', chainId, token.toLowerCase()] as const,
  ens: (chainId: number, address: Address) => ['ens', chainId, address.toLowerCase()] as const,
}

/** SPEC §9.3: changing a chain's RPC or a capability invalidates every key for that chain. */
export const isChainKey = (chainId: number) => (queryKey: readonly unknown[]) =>
  queryKey[1] === chainId
