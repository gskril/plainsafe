// Settings → Back up and Restore (SPEC §3.12, §9.5).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Either } from 'effect'
import { useState } from 'react'
import { FileButton } from '@/components/file-button'
import { Button } from '@/components/ui/button'
import { run } from '@/effect/run'
import {
  applyRestore,
  backupFileName,
  makeBackup,
  planRestore,
  type RestorePlan,
} from '@/features/backup/backup'
import { Callout } from '@/features/review/banners'
import { originOf } from '@/netguard'
import { CAPABILITIES } from './capabilities'

const STORE_NAMES: Record<string, string> = {
  settings: 'Settings',
  safes: 'My Safes',
  recent: 'Recent',
  packages: 'Transactions',
  tokenlists: 'Token lists',
  mytokens: 'My tokens',
  addressbook: 'Address book labels',
  descriptors: 'Imported descriptors',
  abis: 'Saved ABIs',
}

export function BackupSettings() {
  return (
    <div className="flex flex-col gap-8">
      <BackUp />
      <Restore />
    </div>
  )
}

function BackUp() {
  const backup = useMutation({
    mutationFn: async () => {
      const { file, skipped } = await run(makeBackup)
      const blob = new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = backupFileName(file.createdAt)
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return { skipped }
    },
  })
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Back up</h2>
      <p className="text-sm text-muted-foreground">
        Everything you created or chose, as one JSON file: settings, My Safes and Recent,
        transactions and their signatures, token lists and My tokens, address book labels, imported
        descriptors and saved ABIs. Nothing re-readable from the chain is included. The file isn't
        encrypted; keep it somewhere private.
      </p>
      <Button className="self-start" onClick={() => backup.mutate()} disabled={backup.isPending}>
        Download backup
      </Button>
      {backup.data && backup.data.skipped > 0 && (
        <p className="text-sm text-muted-foreground">
          {backup.data.skipped} saved record(s) were invalid and were left out.
        </p>
      )}
      {backup.error && <p className="text-sm text-destructive">{backup.error.message}</p>}
    </section>
  )
}

function Restore() {
  const queryClient = useQueryClient()
  const [plan, setPlan] = useState<RestorePlan>()
  const [error, setError] = useState<string>()
  const apply = useMutation({
    mutationFn: async (p: RestorePlan) => {
      await run(applyRestore(p))
      // Settings, and everything that depends on them, are read again
      await queryClient.invalidateQueries()
    },
    onSuccess: () => setPlan(undefined),
  })
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Restore</h2>
      <p className="text-sm text-muted-foreground">
        Every record in the file is checked before anything is written. Restoring replaces your
        settings, merges transactions with the ones here (keeping every signature), and adds or
        updates everything else.
      </p>
      <FileButton
        className="self-start"
        label="Choose a backup file"
        onFile={async (f) => {
          apply.reset()
          setPlan(undefined)
          setError(undefined)
          const r = await planRestore(await f.text())
          if (Either.isLeft(r)) setError(r.left)
          else setPlan(r.right)
        }}
      />
      {error && (
        <Callout severity="red" title="Can't restore this file">
          {error}
        </Callout>
      )}
      {plan && <PlanView plan={plan} />}
      {plan && (
        <Button
          className="self-start"
          disabled={apply.isPending || plan.records.length === 0}
          onClick={() => apply.mutate(plan)}
        >
          Restore {plan.records.length} record{plan.records.length === 1 ? '' : 's'}
        </Button>
      )}
      {apply.isSuccess && <p className="text-sm">Restored.</p>}
      {apply.error && <p className="text-sm text-destructive">{apply.error.message}</p>}
    </section>
  )
}

function PlanView({ plan }: { plan: RestorePlan }) {
  const s = plan.settings
  const invalid = Object.values(plan.counts).reduce((n, c) => n + (c?.invalid ?? 0), 0)
  const on = s ? CAPABILITIES.filter((c) => s.capabilities[c.key]) : []
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 text-sm" data-testid="restore-plan">
      <p>Backup made {new Date(plan.createdAt).toLocaleString()}.</p>
      <table className="w-full text-left">
        <thead className="text-muted-foreground">
          <tr>
            <th className="font-normal">What</th>
            <th className="font-normal">Valid</th>
            <th className="font-normal">Invalid (skipped)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(plan.counts).map(([store, c]) => (
            <tr key={store}>
              <td>{STORE_NAMES[store] ?? store}</td>
              <td>{c?.valid}</td>
              <td className={c?.invalid ? 'text-destructive' : ''}>{c?.invalid}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {invalid > 0 && (
        <p className="text-destructive">
          {invalid} record(s) failed their checks (for a transaction: its hashes or signatures) and
          won't be restored.
        </p>
      )}
      {plan.unknownStores.length > 0 && (
        <p className="text-muted-foreground">
          Ignored parts this version doesn't know: {plan.unknownStores.join(', ')}.
        </p>
      )}
      {s && (
        <Callout severity="yellow" title="Your settings will be replaced with these">
          <ul className="list-disc pl-5">
            {s.chains.map((c) => (
              <li key={c.id}>
                {c.name} ({c.id}):{' '}
                <span className="font-mono text-xs">
                  {c.rpc._tag === 'url' ? (originOf(c.rpc.url) ?? c.rpc.url) : "your wallet's RPC"}
                </span>
              </li>
            ))}
            <li>
              Network access:{' '}
              {on.length ? on.map((c) => c.label).join(', ') : 'nothing beyond your RPCs'}
              {s.capabilities.tokenListOrigins.length > 0 &&
                `; token lists from ${s.capabilities.tokenListOrigins.join(', ')}`}
            </li>
            <li>Currency: {s.currency}</li>
          </ul>
        </Callout>
      )}
    </div>
  )
}
