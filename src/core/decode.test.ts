import { encodeFunctionData, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'
import { guessCall } from './decode'

describe('signature-database guesses (level 4)', () => {
  const data = encodeFunctionData({
    abi: parseAbi(['function transfer(address to, uint256 amount)']),
    functionName: 'transfer',
    args: ['0x255C3912f91eF11bFDadd405F13144a823Da8cc5', 5n],
  })

  it('uses the first registered signature that decodes, and lists the others', () => {
    const g = guessCall(data, [
      'transfer(address,uint256)',
      'bogus(uint8)',
      'transfer(bytes20,uint256)',
    ])
    expect(g?.signature).toBe('transfer(address,uint256)')
    expect(g?.args.map((a) => a.value)).toEqual(['0x255C3912f91eF11bFDadd405F13144a823Da8cc5', 5n])
    // bogus(uint8) has another selector; transfer(bytes20,…) has another selector too
    expect(g?.alternatives).toEqual([])
  })

  it('returns nothing when no signature decodes', () => {
    expect(guessCall(data, ['approve(address,uint256)', 'not a signature'])).toBeUndefined()
    expect(guessCall('0x1234', ['transfer(address,uint256)'])).toBeUndefined()
  })
})
