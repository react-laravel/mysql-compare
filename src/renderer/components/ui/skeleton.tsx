import * as React from 'react'
import { cn } from '@renderer/lib/utils'

export interface SkeletonProps {
  variant?: 'text' | 'row' | 'tile'
  count?: number
  /** nothing is shown before this — a flash is worse than a blank (DS §7.6) */
  delayMs?: number
  className?: string
}

const VARIANT: Record<NonNullable<SkeletonProps['variant']>, string> = {
  text: 'h-3 w-full rounded-xs',
  row: 'h-row-grid w-full rounded-sm',
  tile: 'h-16 w-full rounded-lg'
}

/** Known-shape loading placeholder. Only rendered after `delayMs`. */
export function Skeleton({ variant = 'text', count = 1, delayMs = 300, className }: SkeletonProps) {
  const [visible, setVisible] = React.useState(delayMs === 0)

  React.useEffect(() => {
    if (delayMs === 0) return
    const timer = setTimeout(() => setVisible(true), delayMs)
    return () => clearTimeout(timer)
  }, [delayMs])

  if (!visible) return null

  return (
    <div className="flex flex-col gap-1.5" aria-hidden data-skeleton={variant}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn('animate-pulse bg-surface-2', VARIANT[variant], className)} />
      ))}
    </div>
  )
}
