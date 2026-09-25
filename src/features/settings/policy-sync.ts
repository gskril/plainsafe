// Keeps netguard's allowlist in step with settings, plus origins the user deliberately tested
// on the setup screen this session (SPEC §3.1: the Test button makes the first request).
import { useEffect } from 'react'
import { netguard } from '@/netguard'
import type { Settings } from '@/schemas/settings'
import { policyFromSettings } from './policy'

const grants = new Set<string>()
let current: Settings | undefined

const apply = () => netguard.setPolicy(policyFromSettings(current, grants))

/** Allow one origin for this session, after an explicit user action. */
export function grantOrigin(origin: string) {
  grants.add(origin)
  apply()
}

/**
 * Apply saved settings to the allowlist now. Called right after saving, so the next screen's
 * reads don't race the query cache update.
 */
export function applySettingsPolicy(settings: Settings | undefined) {
  current = settings
  // Once setup is saved, the allowlist comes from settings alone.
  if (settings?.setupDone) grants.clear()
  apply()
}

export function usePolicySync(settings: Settings | undefined) {
  useEffect(() => applySettingsPolicy(settings), [settings])
}
