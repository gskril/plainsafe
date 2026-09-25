// Keeps history scans going while the app is open (SPEC §11): a scan that hasn't finished
// resumes when the app starts, and every scan restarts when an RPC changes.
import { useEffect } from 'react'
import { run } from '@/effect/run'
import { useLoadedSettings } from '@/queries/settings'
import type { HistoryCheckpoint } from '@/schemas/history'
import type { Settings } from '@/schemas/settings'
import { startHistory, stopAllHistory } from './manager'
import type { ScanTarget } from './scanner'
import { listCheckpoints } from './store'

/** Where a Safe's history is read from: its chain's RPC URL. The wallet's RPC can't be used. */
export function historyTarget(settings: Settings, cp: HistoryCheckpoint): ScanTarget | undefined {
  const chain = settings.chains.find((c) => c.id === cp.chainId)
  if (chain?.rpc._tag !== 'url') return undefined
  return {
    chainId: cp.chainId,
    safe: cp.safe,
    version: cp.version,
    floor: BigInt(cp.floor ?? '0'),
    rpcUrl: chain.rpc.url,
  }
}

export function HistorySync() {
  const settings = useLoadedSettings()
  const rpcs = settings.chains
    .map((c) => `${c.id}=${c.rpc._tag === 'url' ? c.rpc.url : 'wallet'}`)
    .join('|')
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart only when the RPCs change
  useEffect(() => {
    if (!settings.setupDone) return
    stopAllHistory()
    let cancelled = false
    void run(listCheckpoints).then((cps) => {
      if (cancelled) return
      for (const cp of cps) {
        if (!cp.enabled || (cp.status !== undefined && cp.status !== 'scanning')) continue
        const target = historyTarget(settings, cp)
        if (target) startHistory(target)
      }
    })
    return () => {
      cancelled = true
    }
  }, [rpcs, settings.setupDone])
  return null
}
