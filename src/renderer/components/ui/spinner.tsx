import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md'
  /** visible text next to the glyph; also the accessible name when present */
  label?: React.ReactNode
  className?: string
}

const SIZE: Record<NonNullable<SpinnerProps['size']>, string> = {
  xs: 'size-3',
  sm: 'size-3.5',
  md: 'size-4'
}

/** Inline busy indicator. `Loader2` is the reserved "running" glyph. */
export function Spinner({ size = 'sm', label, className }: SpinnerProps) {
  const glyph = (
    <Loader2
      aria-hidden
      strokeWidth={1.75}
      className={cn('animate-spin-slow shrink-0 text-running', SIZE[size], !label && className)}
    />
  )
  if (!label) return glyph
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-fg-muted', className)} role="status">
      {glyph}
      {label}
    </span>
  )
}
