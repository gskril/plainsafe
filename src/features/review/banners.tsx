import { Info, OctagonAlert, ShieldAlert, TriangleAlert } from 'lucide-react'
import type { Banner, Severity } from '@/core/safety-rules'
import { cn } from '@/lib/utils'

const STYLE: Record<Severity, { box: string; icon: typeof Info }> = {
  red: {
    box: 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200',
    icon: OctagonAlert,
  },
  orange: {
    box: 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-orange-950/50 dark:text-orange-200',
    icon: ShieldAlert,
  },
  yellow: {
    box: 'border-yellow-300 bg-yellow-50 text-yellow-900 dark:border-yellow-900 dark:bg-yellow-950/50 dark:text-yellow-100',
    icon: TriangleAlert,
  },
  info: {
    box: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100',
    icon: Info,
  },
}

export function Callout({
  severity,
  title,
  children,
}: {
  severity: Severity
  title: string
  children: React.ReactNode
}) {
  const { box, icon: Icon } = STYLE[severity]
  return (
    <div className={cn('flex gap-3 rounded-lg border p-3 text-sm', box)} data-severity={severity}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">{title}</p>
        <div>{children}</div>
      </div>
    </div>
  )
}

export function SafetyBanners({ banners }: { banners: readonly Banner[] }) {
  if (!banners.length) return null
  return (
    <section className="flex flex-col gap-2" data-testid="banners">
      {banners.map((b) => (
        <Callout key={b.rule} severity={b.severity} title={b.title}>
          {b.body}
        </Callout>
      ))}
    </section>
  )
}
