// Installs netguard on the main thread. Must be the first import of the app (see src/boot.tsx).
import { type GuardScope, installNetguard } from './guard'

export const netguard = installNetguard(globalThis as unknown as GuardScope)

export { CCIP_READ_TAG, NetguardBlockedError, originOf, type Policy, UNTAGGED } from './guard'
export type { LogEntry, Outcome } from './log'
