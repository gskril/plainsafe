import { Link } from 'wouter'

/** A screen from the route map (SPEC §9.4) that a later build step fills in. */
export function Placeholder({ title, step }: { title: string; step: number }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-2 px-4 py-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">Not built yet (SPEC §16 step {step}).</p>
      <Link href="/" className="text-sm underline underline-offset-4">
        Home
      </Link>
    </div>
  )
}

export function NotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-2 px-4 py-8">
      <h1 className="text-xl font-semibold">Not found</h1>
      <Link href="/" className="text-sm underline underline-offset-4">
        Home
      </Link>
    </div>
  )
}
