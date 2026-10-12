import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { Settings } from '@/schemas/settings'
import { defaultSettings } from './defaults'
import { policyFromSettings } from './policy'

describe('policyFromSettings', () => {
  it('allows nothing before setup is done, except origins tested this session', () => {
    expect(policyFromSettings(undefined)).toEqual({ origins: [], ccipRead: false })
    expect(policyFromSettings(defaultSettings)).toEqual({ origins: [], ccipRead: false })
    expect(policyFromSettings(defaultSettings, ['https://rpc.mevblocker.io']).origins).toEqual([
      'https://rpc.mevblocker.io',
    ])
  })

  it('allows each chain RPC origin after setup, and nothing else by default', () => {
    const p = policyFromSettings({ ...defaultSettings, setupDone: true })
    expect(p).toEqual({
      origins: ['https://evm.stupidtech.net', 'https://rpc.mevblocker.io'],
      ccipRead: false,
    })
  })

  it('skips wallet RPCs and adds enabled capability hosts', () => {
    const p = policyFromSettings({
      ...defaultSettings,
      setupDone: true,
      chains: defaultSettings.chains.map((c) => ({ ...c, rpc: { _tag: 'wallet' as const } })),
      capabilities: {
        ...defaultSettings.capabilities,
        sourcify: true,
        ccipRead: true,
        tokenListOrigins: ['https://tokens.uniswap.org'],
      },
    })
    expect(p).toEqual({
      origins: ['https://sourcify.dev', 'https://tokens.uniswap.org'],
      ccipRead: true,
    })
  })

  it('allows api.safe.global only while the Safe Transaction Service capability is on', () => {
    const on = policyFromSettings({
      ...defaultSettings,
      setupDone: true,
      capabilities: { ...defaultSettings.capabilities, safeTransactionService: true },
    })
    expect(on.origins).toContain('https://api.safe.global')
    const off = policyFromSettings({ ...defaultSettings, setupDone: true })
    expect(off.origins).not.toContain('https://api.safe.global')
  })
})

describe('Settings', () => {
  it('decodes settings saved before the Safe Transaction Service capability existed, as off', () => {
    const { safeTransactionService: _, ...before } = defaultSettings.capabilities
    const decoded = Schema.decodeUnknownSync(Settings)({ ...defaultSettings, capabilities: before })
    expect(decoded.capabilities.safeTransactionService).toBe(false)
  })
})
