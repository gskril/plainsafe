import { Schema } from 'effect'
import { isAddress } from 'viem'

/** A 0x address, any case (display code checksums it). */
export const Address = Schema.TemplateLiteral('0x', Schema.String).pipe(
  Schema.filter((s) => isAddress(s, { strict: false }) || 'Expected a 20-byte 0x address'),
)

export const Hex = Schema.TemplateLiteral('0x', Schema.String).pipe(
  Schema.filter((s) => /^0x([0-9a-fA-F]{2})*$/.test(s) || 'Expected 0x-prefixed hex bytes'),
)

export const ChainId = Schema.Int.pipe(Schema.between(1, Number.MAX_SAFE_INTEGER))

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * An RPC endpoint: https, or http (a local node, or one on a LAN or tailnet). Whether this page may
 * reach an http one depends on how the page is served, so that's checked on entry
 * (`rpcUrlProblem`), not here.
 */
export const RpcUrl = Schema.String.pipe(
  Schema.filter((s) => {
    try {
      const { protocol } = new URL(s)
      return protocol === 'https:' || protocol === 'http:' || 'Use an https:// or http:// URL'
    } catch {
      return 'Not a valid URL'
    }
  }),
)

/**
 * Why an RPC URL can't be used from a page served over `pageProtocol`, if it can't. Browsers block
 * http:// requests from an https:// page as mixed content, except to this machine, so such a URL
 * would only fail at Test.
 */
export const rpcUrlProblem = (url: string, pageProtocol: string): string | undefined => {
  const r = Schema.decodeUnknownEither(RpcUrl)(url)
  if (r._tag === 'Left') return 'Use an https:// or http:// URL'
  const u = new URL(url)
  if (pageProtocol === 'https:' && u.protocol === 'http:' && !LOOPBACK.has(u.hostname)) {
    return 'Browsers block http:// from an https:// page, except to localhost. Use an https:// URL (on Tailscale, `tailscale serve` gives your node one).'
  }
  return undefined
}

/** An https URL the app only links to and never fetches (for example a block explorer). */
export const LinkUrl = Schema.String.pipe(
  Schema.filter((s) => {
    try {
      return new URL(s).protocol === 'https:' || 'Use an https:// URL'
    } catch {
      return 'Not a valid URL'
    }
  }),
)

/** A bare origin such as `https://tokens.uniswap.org`. */
export const Origin = Schema.String.pipe(
  Schema.filter((s) => {
    try {
      const u = new URL(s)
      return (u.protocol === 'https:' && u.origin === s) || 'Expected an https origin'
    } catch {
      return 'Not a valid origin'
    }
  }),
)
