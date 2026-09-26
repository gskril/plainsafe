import { Settings } from 'lucide-react'
import { Link } from 'wouter'
import { Button } from '@/components/ui/button'
import { NetworkLogDrawer } from '@/features/network-log/network-log'
import { ConnectMenu } from '@/wallet/connect-menu'

export function Header() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-4xl items-center gap-2 px-4">
        <Link href="/" className="mr-auto shrink-0 font-semibold tracking-tight">
          Plain Safe
        </Link>
        <NetworkLogDrawer />
        <ConnectMenu />
        <Button variant="ghost" size="icon" asChild aria-label="Settings">
          <Link href="/settings">
            <Settings />
          </Link>
        </Button>
      </div>
    </header>
  )
}
