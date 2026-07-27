import * as React from 'react'
import { ArrowDown, ArrowRight, ArrowUp, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { Tone } from './badge'

export interface StatTileProps {
  label: React.ReactNode
  value: React.ReactNode
  icon?: LucideIcon
  hint?: React.ReactNode
  delta?: { value: React.ReactNode; direction: 'up' | 'down' | 'flat'; tone?: Tone }
  size?: 'sm' | 'md'
  mono?: boolean
  onClick?: () => void
  className?: string
}

const DELTA_ICON = { up: ArrowUp, down: ArrowDown, flat: ArrowRight } as const

const DELTA_TONE: Record<Tone, string> = {
  neutral: 'text-fg-muted',
  accent: 'text-accent-text',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
  running: 'text-running-text',
  idle: 'text-fg-muted'
}

/** Label + value + optional delta. Replaces the twice-defined `InfoCard`. */
export function StatTile({
  label,
  value,
  icon: Icon,
  hint,
  delta,
  size = 'sm',
  mono,
  onClick,
  className
}: StatTileProps) {
  const DeltaIcon = delta ? DELTA_ICON[delta.direction] : null
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-fg-muted">
        {Icon ? <Icon aria-hidden strokeWidth={1.75} className="size-3.5" /> : null}
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div
        className={cn(
          'mt-1 break-words font-medium text-fg',
          size === 'md' ? 'text-2xl' : 'text-xl',
          mono && 'font-mono'
        )}
      >
        {value}
      </div>
      {delta ? (
        <div className={cn('mt-1 flex items-center gap-1 text-xs', DELTA_TONE[delta.tone ?? 'neutral'])}>
          {DeltaIcon ? <DeltaIcon aria-hidden strokeWidth={1.75} className="size-3" /> : null}
          {delta.value}
        </div>
      ) : null}
      {hint ? <div className="mt-1 text-xs text-fg-subtle">{hint}</div> : null}
    </>
  )

  const shell = cn('min-w-0 rounded-lg border border-border bg-surface p-3 text-left', className)

  if (!onClick) return <div className={shell}>{body}</div>
  return (
    <button type="button" onClick={onClick} className={cn(shell, 'hover:bg-hover')}>
      {body}
    </button>
  )
}
