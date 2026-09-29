import { getAddress, isAddress } from 'viem'

/** `0x1234…abcd`, checksummed. */
export function shortAddress(address: string): string {
  const a = isAddress(address, { strict: false }) ? getAddress(address) : address
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/** JSON with bigints as decimal strings, for query keys and comparing values by content. */
export const jsonWithBigints = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))

/** A decoded argument as text: integers in full, arrays and structs spelled out. */
export const argText = (v: unknown): string =>
  typeof v === 'bigint'
    ? v.toString()
    : Array.isArray(v)
      ? `[${v.map(argText).join(', ')}]`
      : typeof v === 'object' && v !== null
        ? jsonWithBigints(v)
        : String(v)
