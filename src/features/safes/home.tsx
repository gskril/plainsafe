import { Plus } from 'lucide-react'
import { Link } from 'wouter'
import { Button } from '@/components/ui/button'

export function Home() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My Safes</h1>
        <Button asChild>
          <Link href="/add">
            <Plus /> Add a Safe
          </Link>
        </Button>
      </div>
      <p className="text-muted-foreground">No Safes yet.</p>
      <h2 className="text-lg font-semibold">Recent</h2>
      <p className="text-muted-foreground">Safes you open from shared links appear here.</p>
    </div>
  )
}
