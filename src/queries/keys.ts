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
  /** SPEC §7.3: Sourcify ABIs live only in memory, keyed by implementation code hash. */
  sourcify: (chainId: number, implementationCodeHash: Hex) =>
    ['sourcify', chainId, implementationCodeHash.toLowerCase()] as const,
  signatures: (selector: Hex) => ['signatures', selector.toLowerCase()] as const,
  render: (chainId: number, safeTxHash: Hex) => ['render', chainId, safeTxHash] as const,
  approvals: (chainId: number, safe: Address, safeTxHash: Hex, blockNumber: bigint) =>
    ['approvals', chainId, safe.toLowerCase(), safeTxHash, blockNumber.toString()] as const,
  simulation: (chainId: number, safeTxHash: Hex, blockNumber: bigint) =>
    ['simulation', chainId, safeTxHash, blockNumber.toString()] as const,
  ethFiat: (currency: string) => ['eth-fiat', 1, currency] as const,
  tokenLists: () => ['user', 'tokenlists'] as const,
  userDescriptors: () => ['user', 'descriptors'] as const,
  myTokens: () => ['user', 'mytokens'] as const,
  tokenMeta: (chainId: number, token: Address) =>
    ['token-meta', chainId, token.toLowerCase()] as const,
  ens: (chainId: number, address: Address) => ['ens', chainId, address.toLowerCase()] as const,
  /** SPEC §11: the stored onchain history index (a rebuildable cache in IndexedDB). */
  history: (chainId: number, safe: Address) => ['history', chainId, safe.toLowerCase()] as const,
  /** The transaction that ran an execution (SPEC §11): its calldata and sender. */
  historyTx: (chainId: number, txHash: Hex) =>
    ['history-tx', chainId, txHash.toLowerCase()] as const,
  /** Signers recovered from an execution's signatures: pure, so not tied to a chain. */
  executedSigners: (safeTxHash: Hex, signatures: Hex) =>
    ['executed-signers', safeTxHash.toLowerCase(), signatures.toLowerCase()] as const,
  /** SPEC §3.14: the pre-flight checks for creating the Safe at `address`, as sent from `from`. */
  safeCreation: (chainId: number, address: Address, from?: Address) =>
    ['safe-creation', chainId, address.toLowerCase(), from?.toLowerCase() ?? ''] as const,
  /** SPEC §3.13: are the Uniswap contracts deployed on this chain? */
  swapContracts: (chainId: number) => ['swap-contracts', chainId] as const,
  swapQuote: (chainId: number, sell: Address, buy: Address, amountIn: bigint) =>
    ['swap-quote', chainId, sell.toLowerCase(), buy.toLowerCase(), amountIn.toString()] as const,
  /** A fresh quote for one route, keyed by the route's text. */
  requote: (chainId: number, route: string, amountIn: bigint) =>
    ['requote', chainId, route, amountIn.toString()] as const,
}

/** SPEC §9.3: changing a chain's RPC or a capability invalidates every key for that chain. */
export const isChainKey = (chainId: number) => (queryKey: readonly unknown[]) =>
  queryKey[1] === chainId

/** Every key read from some chain (a capability applies to all chains). */
export const isAnyChainKey = (queryKey: readonly unknown[]) => typeof queryKey[1] === 'number'
