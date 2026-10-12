import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Policy } from '@/netguard/guard'
import { defaultSettings } from './defaults'

const policies: Policy[] = []
vi.mock('@/netguard', () => ({ netguard: { setPolicy: (p: Policy) => policies.push(p) } }))
vi.mock('@/effect/rpc', () => ({ setRpcChains: () => undefined }))

const { applySettingsPolicy, withGrant } = await import('./policy-sync')
const ORIGIN = 'https://api.safe.global'
const allowed = () => policies.at(-1)?.origins.includes(ORIGIN) ?? false

describe('withGrant', () => {
  beforeEach(() => applySettingsPolicy({ ...defaultSettings, setupDone: true }))

  it('allows the origin only while the call runs', async () => {
    let during = false
    await withGrant(ORIGIN, async () => {
      during = allowed()
    })
    expect(during).toBe(true)
    expect(allowed()).toBe(false)
  })

  it('keeps the grant until the last overlapping call finishes, even if one fails', async () => {
    let finishSlow: () => void = () => undefined
    const slow = withGrant(ORIGIN, () => new Promise<void>((r) => (finishSlow = r)))
    await expect(withGrant(ORIGIN, () => Promise.reject(new Error('quick')))).rejects.toThrow()
    expect(allowed()).toBe(true)
    finishSlow()
    await slow
    expect(allowed()).toBe(false)
  })
})
