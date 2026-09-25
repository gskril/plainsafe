import { type Address, encodeFunctionData, erc20Abi, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { ownerManagerAbi } from './builders'
import { decodeCalldata } from './decode'
import { knownAbis, safeManagementAbi } from './known-abis'
import type { SafeTx } from './safe-tx'
import {
  isUnverified,
  needsTypedConfirmation,
  type SafetyInput,
  safetyBanners,
  signingRefused,
} from './safety-rules'

const safe: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const token: Address = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9'
const transfer = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'transfer',
  args: ['0x0000000000000000000000000000000000000001', 5n],
})
const base: SafeTx = {
  to: token,
  value: 0n,
  data: transfer,
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: 5n,
}
const sources = knownAbis.map((k) => ({ source: k.name, abi: k.abi }))

function input(tx: SafeTx, extra: Partial<SafetyInput> = {}): SafetyInput {
  return {
    safe,
    tx,
    decoded: decodeCalldata(
      tx.data,
      tx.to === safe ? [{ source: 'Safe', abi: safeManagementAbi }] : sources,
    ),
    safeVerified: true,
    onchainNonce: 5n,
    targetIsVerifiedMultiSend: false,
    // By default the target's bytecode contains the called function
    target: { hasCode: true, selectors: new Set([tx.data.slice(0, 10)]), isDelegatedEoa: false },
    ...extra,
  }
}
const rules = (i: SafetyInput) => safetyBanners(i).map((b) => `${b.severity}:${b.rule}`)

describe('safety rules (SPEC §7.4)', () => {
  it('a plain decoded ERC-20 transfer at the current nonce has no banners', () => {
    expect(rules(input(base))).toEqual([])
  })

  it('red: delegatecall to anything but a code-hash-verified MultiSend, with typed confirmation', () => {
    const b = safetyBanners(input({ ...base, operation: 1 }))
    expect(b.map((x) => `${x.severity}:${x.rule}`)).toContain('red:delegatecall')
    expect(needsTypedConfirmation(b)).toBe(true)
    expect(
      rules(input({ ...base, operation: 1 }, { targetIsVerifiedMultiSend: true })),
    ).not.toContain('red:delegatecall')
  })

  it('orange: owner, threshold, module, guard and fallback handler changes on the Safe itself', () => {
    const data = encodeFunctionData({
      abi: ownerManagerAbi,
      functionName: 'changeThreshold',
      args: [2n],
    })
    expect(rules(input({ ...base, to: safe, data }))).toEqual(['orange:owner-change'])
    const guard = encodeFunctionData({
      abi: safeManagementAbi,
      functionName: 'setGuard',
      args: [token],
    })
    expect(rules(input({ ...base, to: safe, data: guard }))).toEqual(['orange:owner-change'])
  })

  it('yellow: calldata that cannot be decoded, which also changes the button', () => {
    const b = safetyBanners(
      input(
        { ...base, data: '0xdeadbeef00' },
        { target: { hasCode: true, selectors: new Set(['0xdeadbeef']), isDelegatedEoa: false } },
      ),
    )
    expect(b.map((x) => `${x.severity}:${x.rule}`)).toEqual(['yellow:undecoded'])
    expect(isUnverified(b)).toBe(true)
  })

  it('yellow: non-zero gasPrice, a gasToken or a refundReceiver', () => {
    expect(rules(input({ ...base, gasPrice: 1n }))).toEqual(['yellow:refund'])
    expect(rules(input({ ...base, gasToken: token }))).toEqual(['yellow:refund'])
    expect(rules(input({ ...base, refundReceiver: token }))).toEqual(['yellow:refund'])
  })

  it('info: nonce different from the on-chain nonce', () => {
    const b = safetyBanners(input({ ...base, nonce: 7n }))
    expect(b.map((x) => `${x.severity}:${x.rule}`)).toEqual(['info:nonce'])
    expect(b[0]?.title).toMatch(/future/)
    expect(safetyBanners(input({ ...base, nonce: 4n }))[0]?.title).toMatch(/already used/)
  })

  it('yellow: whatsabi finds no code at the target, or the selector missing from its bytecode', () => {
    expect(
      rules(
        input(base, { target: { hasCode: false, selectors: new Set(), isDelegatedEoa: false } }),
      ),
    ).toEqual(['yellow:target-no-code'])
    expect(
      rules(
        input(base, {
          target: { hasCode: true, selectors: new Set(['0x095ea7b3']), isDelegatedEoa: false },
        }),
      ),
    ).toEqual(['yellow:selector-missing'])
  })

  it('red: an unknown or unsupported singleton refuses signing', () => {
    const b = safetyBanners(input(base, { safeVerified: false }))
    expect(b.map((x) => `${x.severity}:${x.rule}`)).toEqual(['red:unsupported-safe'])
    expect(signingRefused(b)).toBe(true)
  })

  it('sorts red, orange, yellow, then info', () => {
    const data = encodeFunctionData({
      abi: ownerManagerAbi,
      functionName: 'changeThreshold',
      args: [2n],
    })
    expect(
      rules(input({ ...base, to: safe, data, nonce: 9n, gasPrice: 1n, operation: 1 })),
    ).toEqual(['red:delegatecall', 'yellow:refund', 'info:nonce'])
  })
})

describe('decodeCalldata', () => {
  it('decodes with a known ABI only when the selector is in the bytecode', () => {
    expect(decodeCalldata(transfer, sources)).toMatchObject({
      kind: 'abi',
      level: 3,
      source: 'ERC-20',
      functionName: 'transfer',
    })
    expect(decodeCalldata(transfer, sources, new Set(['0x095ea7b3']))).toEqual({
      kind: 'raw',
      level: 5,
      selector: '0xa9059cbb',
    })
    expect(decodeCalldata('0x', sources)).toEqual({ kind: 'empty' })
    expect(decodeCalldata('0x1234', sources)).toEqual({ kind: 'raw', level: 5 })
  })

  it('treats a matching selector with undecodable arguments as raw', () => {
    expect(decodeCalldata('0xa9059cbb1234', sources)).toMatchObject({ kind: 'raw', level: 5 })
  })
})
