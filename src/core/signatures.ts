// Safe signature encoding (SPEC §5.2) and checks (SPEC §5.3).
import {
  type Address,
  concat,
  getAddress,
  type Hex,
  hexToNumber,
  isHex,
  pad,
  recoverAddress,
  size,
  slice,
} from 'viem'

export interface Eip712Signature {
  readonly signer: Address
  readonly kind: 'eip712'
  /** r ‖ s ‖ v, 65 bytes, v ∈ {27, 28}. */
  readonly data: Hex
}

export type SignatureProblem = 'not-65-bytes' | 'bad-v'

/** Only plain EOA EIP-712 signatures are accepted (SPEC §5.2: no eth_sign, no EIP-1271). */
export function checkEip712SignatureBytes(data: Hex): SignatureProblem | undefined {
  if (!isHex(data) || size(data) !== 65) return 'not-65-bytes'
  const v = hexToNumber(slice(data, 64, 65))
  return v === 27 || v === 28 ? undefined : 'bad-v'
}

/** Some wallets return v as 0/1 (the recovery id). Safe expects 27/28. */
export function normalizeV(data: Hex): Hex {
  if (!isHex(data) || size(data) !== 65) return data
  const v = hexToNumber(slice(data, 64, 65))
  return v === 0 || v === 1 ? concat([slice(data, 0, 64), v === 0 ? '0x1b' : '0x1c']) : data
}

/** The address that signed `safeTxHash`, or undefined if the bytes aren't a valid signature. */
export async function recoverSigner(safeTxHash: Hex, data: Hex): Promise<Address | undefined> {
  if (checkEip712SignatureBytes(data)) return undefined
  try {
    return getAddress(await recoverAddress({ hash: safeTxHash, signature: data }))
  } catch {
    return undefined
  }
}

/** Pre-validated signature: r = owner, s = 0, v = 1. Valid when msg.sender is that owner. */
export function prevalidatedSignature(owner: Address): Hex {
  return concat([pad(owner, { size: 32 }), pad('0x', { size: 32 }), '0x01'])
}

const byAddress = (a: { signer: Address }, b: { signer: Address }) => {
  const x = BigInt(a.signer)
  const y = BigInt(b.signer)
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * Concatenate signatures in ascending order of signer address, as checkNSignatures requires.
 * Duplicate signers are dropped (first one wins).
 */
export function encodeSignatures(sigs: readonly { signer: Address; data: Hex }[]): Hex {
  const seen = new Set<string>()
  const unique = sigs.filter((s) => {
    const k = s.signer.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return unique.length ? concat([...unique].sort(byAddress).map((s) => s.data)) : '0x'
}
