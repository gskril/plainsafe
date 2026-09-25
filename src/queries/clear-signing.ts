import type { ExternalDataProvider, TrustedTokens } from '@ethereum-sourcify/clear-signing'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { type Address, type Hex, keccak256, toHex } from 'viem'
import type { SafeTx } from '@/core/safe-tx'
import { run } from '@/effect/run'
import { renderClearSigning } from '@/features/clear-signing/render'
import type { SafeContext } from '@/features/clear-signing/resolver'
import {
  descriptorCache,
  listUserDescriptors,
  toUserDescriptor,
} from '@/features/clear-signing/store'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { labelFor } from '@/features/safes/store'
import { tokenMeta } from '@/features/tokens/token-meta'
import { keys } from './keys'
import { useAddressBook } from './safes'
import { useLoadedSettings } from './settings'
import { useTokenUniverse } from './tokens'

export function useUserDescriptors() {
  return useQuery({
    queryKey: keys.userDescriptors(),
    queryFn: () => run(listUserDescriptors),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * The clear-signing rendering of a Safe transaction (SPEC §7.2), for code-hash-verified Safes
 * only: the descriptor is chosen by the version the code hash proves.
 */
export function useClearSigning(
  chainId: number,
  safe: SafeSnapshot | undefined,
  tx: SafeTx,
  safeTxHash: Hex,
) {
  const a = safe?.authenticity
  const ctx =
    safe && a?.status === 'verified'
      ? { chainId, safe: safe.address, version: a.version, l2: a.l2 }
      : undefined
  return useClearSigningFor(ctx, tx, safeTxHash, false)
}

/**
 * The same rendering for a given context. `offline` (the Verify page, SPEC §3.10) uses only
 * bundled and imported descriptors and local token data: no RPC and no registry downloads.
 */
export function useClearSigningFor(
  ctx: SafeContext | undefined,
  tx: SafeTx,
  safeTxHash: Hex,
  offline: boolean,
) {
  const chainId = ctx?.chainId ?? 0
  const settings = useLoadedSettings()
  const remote = !offline && settings.capabilities.clearSigningDescriptors
  const tokens = useTokenUniverse(chainId)
  const book = useAddressBook()
  const user = useUserDescriptors()

  const trustedTokens = useMemo((): TrustedTokens | undefined => {
    if (!tokens) return undefined
    return {
      [chainId]: Object.fromEntries(tokens.map((t) => [t.address.toLowerCase(), 'erc20' as const])),
    }
  }, [chainId, tokens])

  const provider = useMemo((): ExternalDataProvider | undefined => {
    if (!tokens || !book.data) return undefined
    const entries = book.data.entries
    return {
      // Token lists and My tokens first; otherwise read it over RPC and say so (SPEC §7.2).
      resolveToken: async (id, address) => {
        if (id !== chainId) return null
        const known = tokens.find((t) => t.address.toLowerCase() === address.toLowerCase())
        if (known) return { name: known.name, symbol: known.symbol, decimals: known.decimals }
        if (offline) return null
        try {
          const m = await run(tokenMeta(chainId, address as Address))
          return {
            name: m.name ?? m.symbol,
            symbol: `${m.symbol} (not in your lists)`,
            decimals: m.decimals,
          }
        } catch {
          return null
        }
      },
      resolveLocalName: async (address) => {
        const label = labelFor(entries, chainId, address)
        return label ? { name: label, typeMatch: true } : null
      },
      resolveChainInfo: async (id) => {
        const c = settings.chains.find((x) => x.id === id)
        return c ? { name: c.name, nativeCurrency: { ...c.nativeCurrency } } : null
      },
    }
  }, [tokens, book.data, chainId, settings.chains, offline])

  const tokenSet = useMemo(
    () =>
      trustedTokens
        ? keccak256(
            toHex(
              Object.keys(trustedTokens[chainId] ?? {})
                .sort()
                .join(','),
            ),
          )
        : '0x',
    [chainId, trustedTokens],
  )
  return useQuery({
    queryKey: [
      ...keys.render(chainId, safeTxHash),
      ctx?.safe,
      ctx?.version,
      ctx?.l2,
      remote,
      offline,
      tokenSet,
      book.dataUpdatedAt,
      user.dataUpdatedAt,
    ],
    queryFn: () =>
      renderClearSigning(ctx as SafeContext, tx, {
        remote,
        userDescriptors: (user.data?.descriptors ?? []).map(toUserDescriptor),
        externalDataProvider: provider as ExternalDataProvider,
        trustedTokens: trustedTokens as TrustedTokens,
        cache: offline ? undefined : descriptorCache,
      }).then((r) => r ?? null),
    enabled: !!ctx && !!provider && !!trustedTokens && user.isFetched,
    staleTime: Number.POSITIVE_INFINITY,
  })
}
