import { getAddress, isAddress } from 'viem'

/** `0x1234…abcd`, checksummed. */
export function shortAddress(address: string): string {
  const a = isAddress(address, { strict: false }) ? getAddress(address) : address
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}
