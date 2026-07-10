import * as React from 'react'
import { cn } from '@renderer/lib/utils'

type Variant = 'default' | 'success' | 'warning' | 'destructive' | 'info'

const VARIANTS: Record<Variant, string> = {
  default: 'bg-secondary text-secondary-foreground',
  success: 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/40',
  warning: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40',
  destructive: 'bg-destructive/20 text-destructive dark:text-red-300 border border-destructive/40',
  info: 'bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/40'
}

export function Badge({
  children,
  variant = 'default',
  className
}: {
  children: React.ReactNode
  variant?: Variant
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium', VARIANTS[variant], className)}>
      {children}
    </span>
  )
}
