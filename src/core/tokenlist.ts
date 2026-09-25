// Parsing Uniswap-format token lists with partial acceptance (SPEC §10), and exporting My tokens.
import { Either, Schema } from 'effect'
import { getAddress } from 'viem'
import { ListToken, TokenListEnvelope } from '@/schemas/tokenlist'

export interface ParsedList {
  readonly name: string
  readonly tokens: readonly ListToken[]
  /** Malformed tokens skipped one at a time, rather than rejecting the whole list. */
  readonly skipped: number
}

export function parseTokenList(json: unknown): Either.Either<ParsedList, string> {
  const envelope = Schema.decodeUnknownEither(TokenListEnvelope)(json)
  if (Either.isLeft(envelope))
    return Either.left('Not a token list (it needs a name and a tokens array).')
  const seen = new Set<string>()
  const tokens: ListToken[] = []
  let skipped = 0
  for (const raw of envelope.right.tokens) {
    const t = Schema.decodeUnknownEither(ListToken)(raw)
    if (Either.isLeft(t)) {
      skipped++
      continue
    }
    const key = `${t.right.chainId}:${t.right.address.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    tokens.push({ ...t.right, address: getAddress(t.right.address) })
  }
  return Either.right({ name: envelope.right.name, tokens, skipped })
}

/** My tokens as a Uniswap-format list (SPEC §10). */
export function exportTokenList(name: string, tokens: readonly ListToken[], now = new Date()) {
  return {
    name,
    timestamp: now.toISOString(),
    version: { major: 1, minor: 0, patch: 0 },
    tokens: tokens.map(({ chainId, address, symbol, name: n, decimals }) => ({
      chainId,
      address,
      symbol,
      name: n || symbol,
      decimals,
    })),
  }
}

/** Addresses of tokens whose symbol is shared by another token on the same chain (SPEC §10). */
export function duplicateSymbols(
  tokens: readonly { chainId: number; address: string; symbol: string }[],
): Set<string> {
  const bySymbol = new Map<string, Set<string>>()
  for (const t of tokens) {
    const k = `${t.chainId}:${t.symbol.toUpperCase()}`
    const set = bySymbol.get(k) ?? new Set()
    set.add(t.address.toLowerCase())
    bySymbol.set(k, set)
  }
  const out = new Set<string>()
  for (const set of bySymbol.values()) if (set.size > 1) for (const a of set) out.add(a)
  return out
}
