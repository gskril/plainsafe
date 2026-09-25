// Signature progress (SPEC §3.4 item 7): checked against the *current* owners (SPEC §5.3).
import { AddressView } from '@/components/address'
import { classifySigners, type RejectedSignature } from '@/core/package'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import type { PackageSignature } from '@/schemas/package'

export function SignatureProgress(props: {
  chainId: number
  safe?: SafeSnapshot | undefined
  signatures: readonly PackageSignature[]
  rejected?: readonly RejectedSignature[]
}) {
  const { safe, signatures } = props
  const { owners: valid, nonOwners } = classifySigners(signatures, safe?.owners)
  const signed = new Set(valid.map((s) => s.signer.toLowerCase()))
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4" data-testid="signatures">
      <h2 className="font-medium">
        Signatures{' '}
        {safe?.threshold !== undefined && (
          <span data-testid="signature-count">
            {valid.length} of {safe.threshold.toString()}
          </span>
        )}
      </h2>
      {!safe?.owners && <p className="text-sm text-muted-foreground">Owners not loaded yet.</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {safe?.owners?.map((o) => (
          <li key={o} className="flex items-center gap-2">
            <span
              className={
                signed.has(o.toLowerCase())
                  ? 'w-24 text-emerald-700 dark:text-emerald-400'
                  : 'w-24 text-muted-foreground'
              }
            >
              {signed.has(o.toLowerCase()) ? '✓ signed' : 'not signed'}
            </span>
            <AddressView chainId={props.chainId} address={o} />
          </li>
        ))}
        {safe?.owners &&
          nonOwners.map((s) => (
            <li
              key={s.signer}
              className="flex items-center gap-2 text-amber-700 dark:text-amber-400"
            >
              <span className="w-24">ignored</span>
              <AddressView chainId={props.chainId} address={s.signer} />
              <span>signature from non-owner</span>
            </li>
          ))}
        {props.rejected?.map((r) => (
          <li key={r.signer} className="text-destructive">
            Rejected signature claimed by {r.signer}: {r.reason}.
          </li>
        ))}
      </ul>
    </section>
  )
}
