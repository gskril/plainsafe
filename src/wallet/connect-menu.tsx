// A small connect menu over wagmi's discovered connectors (SPEC §8.3). No third-party modal.
import { Wallet } from 'lucide-react'
import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { shortAddress } from '@/lib/format'

/** Wallet icons are only shown when they are inline data, so they never cause a request. */
const safeIcon = (icon?: string) => (icon?.startsWith('data:image/') ? icon : undefined)

export function ConnectMenu() {
  const connection = useConnection()
  const connectors = useConnectors()
  const connect = useConnect()
  const disconnect = useDisconnect()

  if (connection.status === 'connected') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" data-testid="wallet-button">
            <Wallet />
            <span className="font-mono">{shortAddress(connection.address)}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="font-mono text-xs">{connection.address}</DropdownMenuLabel>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {connection.connector.name} · chain {connection.chainId}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => disconnect.mutate({})}>Disconnect</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-testid="wallet-button">
          <Wallet />
          {connection.status === 'connecting' ? 'Connecting…' : 'Connect'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {connectors.length === 0 && (
          <DropdownMenuLabel className="font-normal text-muted-foreground">
            No browser wallet found
          </DropdownMenuLabel>
        )}
        {connectors.map((connector) => {
          const icon = safeIcon(connector.icon)
          return (
            <DropdownMenuItem key={connector.uid} onSelect={() => connect.mutate({ connector })}>
              {icon ? <img src={icon} alt="" className="size-4" /> : <Wallet />}
              {connector.name}
            </DropdownMenuItem>
          )
        })}
        {connect.error && (
          <DropdownMenuLabel className="max-w-64 font-normal text-destructive">
            {connect.error.message.split('\n')[0]}
          </DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
