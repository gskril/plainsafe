// Settings → Onchain history (SPEC §3.12, §11, P1): which Safes have it on, and their state.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'wouter'
import { Button } from '@/components/ui/button'
import { run } from '@/effect/run'
import { stopHistory } from '@/features/history/manager'
import { listCheckpoints, turnOffHistory } from '@/features/history/store'
import { shortAddress } from '@/lib/format'
import { useLoadedSettings } from '@/queries/settings'

const STATUS: Record<string, string> = {
  scanning: 'scanning',
  complete: 'complete',
  incomplete: 'incomplete',
  unavailable: 'unavailable',
}

export function HistorySettings() {
  const settings = useLoadedSettings()
  const queryClient = useQueryClient()
  const list = useQuery({ queryKey: ['history', 'all'], queryFn: () => run(listCheckpoints) })
  const chainName = (id: number) => settings.chains.find((c) => c.id === id)?.name ?? `Chain ${id}`
  const on = (list.data ?? []).filter((c) => c.enabled)
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Onchain history</h2>
      <p className="text-sm text-muted-foreground">
        Turn it on from a Safe's History view. The scan reads logs over that chain's RPC, runs in
        the background while Plain Safe is open, and is stored only in this browser. It's a cache:
        it isn't in backups and can always be rebuilt.
      </p>
      {on.length === 0 ? (
        <p className="text-sm text-muted-foreground">Off for every Safe.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {on.map((c) => (
            <li key={`${c.chainId}:${c.safe}`} className="flex items-center gap-3 p-3 text-sm">
              <Link
                href={`/safe/${c.chainId}/${c.safe}/history`}
                className="flex-1 font-mono underline underline-offset-2"
              >
                {shortAddress(c.safe)}
              </Link>
              <span className="text-muted-foreground">
                {chainName(c.chainId)} · {STATUS[c.status ?? 'scanning']}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  stopHistory(c.chainId, c.safe)
                  await run(turnOffHistory(c.chainId, c.safe))
                  await queryClient.invalidateQueries({ queryKey: ['history'] })
                }}
              >
                Turn off
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
