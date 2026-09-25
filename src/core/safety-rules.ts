// Safety rules (SPEC §7.4). Computed from the decoded transaction and chain facts only, never
// from clear-signing descriptor text.
import { type Address, type Hex, zeroAddress } from 'viem'
import type { Decoded } from './decode'
import type { SafeTx } from './safe-tx'

export type Severity = 'red' | 'orange' | 'yellow' | 'info'

export interface Banner {
  readonly rule:
    | 'delegatecall'
    | 'owner-change'
    | 'undecoded'
    | 'refund'
    | 'nonce'
    | 'target-no-code'
    | 'selector-missing'
    | 'unsupported-safe'
  readonly severity: Severity
  readonly title: string
  readonly body: string
}

export interface SafetyInput {
  readonly safe: Address
  readonly tx: SafeTx
  readonly decoded: Decoded
  /** Safe authenticity: anything but 'verified' refuses signing. */
  readonly safeVerified: boolean
  readonly onchainNonce?: bigint
  /** The target's own code hash matches a MultiSend or MultiSendCallOnly (SPEC §4.2). */
  readonly targetIsVerifiedMultiSend: boolean
  /** From whatsabi, when available. */
  readonly target?: {
    readonly hasCode: boolean
    readonly selectors: ReadonlySet<string>
    readonly isDelegatedEoa: boolean
  }
}

/** Calls on the Safe that change who controls it. */
export const CONTROL_FUNCTIONS = new Set([
  'addOwnerWithThreshold',
  'removeOwner',
  'swapOwner',
  'changeThreshold',
  'enableModule',
  'disableModule',
  'setGuard',
  'setModuleGuard',
  'setFallbackHandler',
])

const SEVERITY_ORDER: Record<Severity, number> = { red: 0, orange: 1, yellow: 2, info: 3 }

export function safetyBanners(input: SafetyInput): Banner[] {
  const { tx, decoded } = input
  const out: Banner[] = []
  const toSafe = tx.to.toLowerCase() === input.safe.toLowerCase()

  if (!input.safeVerified) {
    out.push({
      rule: 'unsupported-safe',
      severity: 'red',
      title: 'This Safe could not be verified',
      body: 'Its code does not match a known, supported Safe release, so signing is refused.',
    })
  }

  if (tx.operation === 1 && !input.targetIsVerifiedMultiSend) {
    out.push({
      rule: 'delegatecall',
      severity: 'red',
      title: 'DELEGATECALL to an unknown contract',
      body: `DELEGATECALL runs ${tx.to}'s code with this Safe's storage and funds. It can take over this Safe. Only sign if you know exactly why this is needed.`,
    })
  }

  if (
    toSafe &&
    tx.operation === 0 &&
    decoded.kind === 'abi' &&
    CONTROL_FUNCTIONS.has(decoded.functionName)
  ) {
    out.push({
      rule: 'owner-change',
      severity: 'orange',
      title: 'Changes who controls this Safe',
      body:
        decoded.functionName.includes('Owner') || decoded.functionName === 'changeThreshold'
          ? 'This changes the owners or the threshold. Check the before → after view carefully.'
          : `This calls ${decoded.functionName}, which changes the Safe's modules, guard or fallback handler.`,
    })
  }

  if (decoded.kind === 'raw') {
    out.push({
      rule: 'undecoded',
      severity: 'yellow',
      title: 'Unverified: raw calldata',
      body: 'This calldata could not be decoded with a known ABI. What it does can only be judged from the raw bytes.',
    })
  }

  if (
    tx.gasPrice !== 0n ||
    tx.gasToken.toLowerCase() !== zeroAddress ||
    tx.refundReceiver.toLowerCase() !== zeroAddress
  ) {
    out.push({
      rule: 'refund',
      severity: 'yellow',
      title: 'Gas refund fields are set',
      body: `The executor is paid from the Safe: up to (baseGas + gas used) × gasPrice ${tx.gasPrice.toString()} in ${tx.gasToken === zeroAddress ? 'the native currency' : tx.gasToken}, sent to ${tx.refundReceiver === zeroAddress ? 'whoever executes' : tx.refundReceiver}. A malicious combination can drain funds.`,
    })
  }

  if (input.target && tx.data !== '0x') {
    if (!input.target.hasCode) {
      out.push({
        rule: 'target-no-code',
        severity: 'yellow',
        title: 'Target has no code (an EOA)',
        body: 'This transaction sends calldata to an address with no contract code, so the calldata does nothing.',
      })
    } else if (!input.target.isDelegatedEoa && tx.data.length >= 10) {
      const selector = tx.data.slice(0, 10).toLowerCase() as Hex
      if (!input.target.selectors.has(selector)) {
        out.push({
          rule: 'selector-missing',
          severity: 'yellow',
          title: `Function ${selector} is not in the target's bytecode`,
          body: 'The called function was not found in the contract (after following proxies). The call may hit a fallback, or revert.',
        })
      }
    }
  }

  if (input.onchainNonce !== undefined && tx.nonce !== input.onchainNonce) {
    out.push({
      rule: 'nonce',
      severity: 'info',
      title:
        tx.nonce < input.onchainNonce
          ? `Nonce ${tx.nonce} is already used`
          : `Nonce ${tx.nonce} is in the future`,
      body:
        tx.nonce < input.onchainNonce
          ? `The Safe's nonce is ${input.onchainNonce}. This transaction can never execute.`
          : `The Safe's nonce is ${input.onchainNonce}. This transaction waits until nonces ${input.onchainNonce}–${tx.nonce - 1n} execute, or replaces a queued one with the same nonce.`,
    })
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

/** Signing is refused outright for an unverified Safe (SPEC §4.1). */
export const signingRefused = (banners: readonly Banner[]) =>
  banners.some((b) => b.rule === 'unsupported-safe')
/** A red delegatecall banner needs a typed confirmation (SPEC §7.4). */
export const needsTypedConfirmation = (banners: readonly Banner[]) =>
  banners.some((b) => b.rule === 'delegatecall')
/** The main button reads "Sign unverified transaction" (SPEC §7.4). */
export const isUnverified = (banners: readonly Banner[]) =>
  banners.some((b) => b.rule === 'undecoded')
