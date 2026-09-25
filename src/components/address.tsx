// An address as shown everywhere: the local label (address book only, SPEC §6) next to the
// shortened checksummed address, never alone. Copy button and explorer link.
import { Check, Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { getAddress } from 'viem'
import { explorerUrl } from '@/chains'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { labelFor } from '@/features/safes/store'
import { shortAddress } from '@/lib/format'
import { useAddressBook } from '@/queries/safes'
import { useLoadedSettings } from '@/queries/settings'

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

export function AddressView(props: { chainId: number; address: string; full?: boolean }) {
  const settings = useLoadedSettings()
  const book = useAddressBook()
  const address = getAddress(props.address)
  const label = book.data ? labelFor(book.data.entries, props.chainId, address) : undefined
  const chain = settings.chains.find((c) => c.id === props.chainId)
  const href = chain ? explorerUrl(chain, 'address', address) : undefined
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {label && <span className="truncate font-medium">{label}</span>}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="font-mono text-sm break-all" data-address={address}>
            {props.full ? address : shortAddress(address)}
          </span>
        </TooltipTrigger>
        <TooltipContent className="font-mono">{address}</TooltipContent>
      </Tooltip>
      <CopyButton value={address} label="Copy address" />
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label="Open in block explorer"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </span>
  )
}
