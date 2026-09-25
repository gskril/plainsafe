// A one-line summary computed from the decoded call (SPEC §3.4 item 2), used when there's no
// builder description. Clear signing (when it resolves) takes precedence later.
import { type Address, formatUnits, getAddress } from 'viem'
import type { Decoded } from './decode'
import type { SafeTx } from './safe-tx'

const short = (a: string) => {
  const c = getAddress(a)
  return `${c.slice(0, 6)}…${c.slice(-4)}`
}

export function describeCall(
  tx: SafeTx,
  decoded: Decoded,
  safe: Address,
  currency: { symbol: string; decimals: number },
): string {
  if (decoded.kind === 'empty')
    return `Send ${formatUnits(tx.value, currency.decimals)} ${currency.symbol} to ${short(tx.to)}`
  if (decoded.kind === 'raw') return `Unverified call to ${short(tx.to)}`
  const v = decoded.args.map((a) => a.value)
  if (tx.to.toLowerCase() === safe.toLowerCase()) {
    switch (decoded.functionName) {
      case 'addOwnerWithThreshold':
        return `Add owner ${short(v[0] as string)} and set threshold to ${v[1]}`
      case 'removeOwner':
        return `Remove owner ${short(v[1] as string)} and set threshold to ${v[2]}`
      case 'swapOwner':
        return `Replace owner ${short(v[1] as string)} with ${short(v[2] as string)}`
      case 'changeThreshold':
        return `Change threshold to ${v[0]}`
    }
  }
  if (decoded.source.startsWith('ERC-20') && decoded.functionName === 'transfer') {
    return `Transfer tokens (${short(tx.to)}) to ${short(v[0] as string)}`
  }
  return `Call ${decoded.functionName} on ${short(tx.to)}`
}
