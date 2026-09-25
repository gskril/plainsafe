// The network log (SPEC §8.1): every request attempt, allowed or blocked, from this session.
import { Activity } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { netguard } from '@/netguard'
import type { LogEntry } from '@/netguard/log'
import { useNetLog } from './use-net-log'

const OUTCOME: Record<LogEntry['outcome'], string> = {
  allowed: 'text-emerald-700 dark:text-emerald-400',
  blocked: 'text-red-700 dark:text-red-400',
  failed: 'text-amber-700 dark:text-amber-400',
}

export function NetworkLogList({ entries }: { entries: readonly LogEntry[] }) {
  if (!entries.length) {
    return <p className="text-muted-foreground">No network requests yet.</p>
  }
  return (
    <ol className="flex flex-col divide-y font-mono text-xs" data-testid="network-log">
      {[...entries].reverse().map((e) => (
        <li key={e.id} className="flex flex-col gap-0.5 py-2" data-outcome={e.outcome}>
          <div className="flex items-center gap-2">
            <span className={cn('font-semibold uppercase', OUTCOME[e.outcome])}>{e.outcome}</span>
            <span className="text-muted-foreground">{new Date(e.time).toLocaleTimeString()}</span>
            <span className="text-muted-foreground">{e.transport}</span>
            {e.status !== undefined && <span className="text-muted-foreground">{e.status}</span>}
          </div>
          <div className="break-all">
            <span className="font-semibold" data-testid="network-log-host">
              {e.host}
            </span>
            {e.path}
          </div>
          <div className="flex flex-wrap gap-1 text-muted-foreground">
            <span>{e.tag}</span>
            {e.source && <span>· {e.source}</span>}
            {e.methods.length > 0 && <span>· {summarize(e.methods)}</span>}
          </div>
          {e.error && <div className="break-all text-amber-700 dark:text-amber-400">{e.error}</div>}
        </li>
      ))}
    </ol>
  )
}

function summarize(methods: readonly string[]) {
  const counts = new Map<string, number>()
  for (const m of methods) counts.set(m, (counts.get(m) ?? 0) + 1)
  return [...counts].map(([m, n]) => (n > 1 ? `${m} ×${n}` : m)).join(', ')
}

/** The header indicator: request count, red when anything was blocked. Opens the drawer. */
export function NetworkLogDrawer() {
  const entries = useNetLog()
  const blocked = netguard.log.blockedCount()
  const hosts = [...new Set(entries.filter((e) => e.outcome !== 'blocked').map((e) => e.host))]
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Network log: ${entries.length} requests, ${blocked} blocked`}
          data-testid="network-indicator"
          className={cn(blocked > 0 && 'text-red-700 dark:text-red-400')}
        >
          <Activity />
          <span>{entries.length}</span>
          {blocked > 0 && <Badge variant="destructive">{blocked} blocked</Badge>}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Network log</SheetTitle>
          <SheetDescription>
            Every request this tab attempted since it opened. Plain Safe only contacts your RPCs and
            any capability you turned on.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="text-sm">
            <span className="font-medium">Hosts contacted: </span>
            {hosts.length ? hosts.join(', ') : 'none'}
          </div>
          <NetworkLogList entries={entries} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
