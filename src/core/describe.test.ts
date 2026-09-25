import { encodeFunctionData, erc20Abi, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { ownerManagerAbi } from './builders'
import { decodeCalldata } from './decode'
import { describeCall } from './describe'
import { knownAbis, safeManagementAbi } from './known-abis'
import type { SafeTx } from './safe-tx'

const safe = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const eth = { symbol: 'ETH', decimals: 18 }
const tx = (p: Partial<SafeTx>): SafeTx => ({
  to: '0x255C3912f91eF11bFDadd405F13144a823Da8cc5',
  value: 0n,
  data: '0x',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: 0n,
  ...p,
})
const std = knownAbis.map((k) => ({ source: k.name, abi: k.abi }))

describe('describeCall', () => {
  it('describes transfers, owner changes, calls and raw calldata', () => {
    const send = tx({ value: 10n ** 16n })
    expect(describeCall(send, decodeCalldata(send.data, std), safe, eth)).toBe(
      'Send 0.01 ETH to 0x255C…8cc5',
    )
    const add = tx({
      to: safe,
      data: encodeFunctionData({
        abi: ownerManagerAbi,
        functionName: 'addOwnerWithThreshold',
        args: ['0x000000000000000000000000000000000000bEEF', 2n],
      }),
    })
    expect(
      describeCall(
        add,
        decodeCalldata(add.data, [{ source: 'Safe', abi: safeManagementAbi }]),
        safe,
        eth,
      ),
    ).toBe('Add owner 0x0000…bEEF and set threshold to 2')
    const approve = tx({
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [safe, 1n] }),
    })
    expect(describeCall(approve, decodeCalldata(approve.data, std), safe, eth)).toBe(
      'Call approve on 0x255C…8cc5',
    )
    const raw = tx({ data: '0xdeadbeef' })
    expect(describeCall(raw, decodeCalldata(raw.data, std), safe, eth)).toBe(
      'Unverified call to 0x255C…8cc5',
    )
  })
})
