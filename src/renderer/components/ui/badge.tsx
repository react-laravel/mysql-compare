import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export type Tone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'running'
  | 'idle'

export type BadgeVariant = 'quiet' | 'solid' | 'outline'

const TONE: Record<Tone, Record<BadgeVariant, string>> = {
  neutral: {
    quiet: 'bg-surface-2 text-fg-muted border-border',
    solid: 'bg-fg-muted text-surface border-transparent',
    outline: 'bg-transparent text-fg-muted border-border'
  },
  accent: {
    quiet: 'bg-accent-quiet text-accent-text border-accent/30',
    solid: 'bg-accent text-accent-fg border-transparent',
    outline: 'bg-transparent text-accent-text border-accent/40'
  },
  success: {
    quiet: 'bg-success-quiet text-success-text border-success/30',
    solid: 'bg-success text-surface border-transparent',
    outline: 'bg-transparent text-success-text border-success/40'
  },
  warning: {
    quiet: 'bg-warning-quiet text-warning-text border-warning/30',
    solid: 'bg-warning text-surface border-transparent',
    outline: 'bg-transparent text-warning-text border-warning/40'
  },
  danger: {
    quiet: 'bg-danger-quiet text-danger-text border-danger/30',
    solid: 'bg-danger text-danger-fg border-transparent',
    outline: 'bg-transparent text-danger-text border-danger/40'
  },
  running: {
    quiet: 'bg-running-quiet text-running-text border-running/30',
    solid: 'bg-running text-accent-fg border-transparent',
    outline: 'bg-transparent text-running-text border-running/40'
  },
  idle: {
    quiet: 'bg-idle-quiet text-fg-muted border-border',
    solid: 'bg-idle text-surface border-transparent',
    outline: 'bg-transparent text-fg-muted border-border'
  }
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  size?: 'xs' | 'sm'
  variant?: BadgeVariant
  icon?: LucideIcon
}

/**
 * Counts and states. Colour never carries the meaning alone — pass `icon` (or a
 * label) on anything that encodes status.
 */
export function Badge({
  children,
  tone = 'neutral',
  size = 'sm',
  variant = 'quiet',
  icon: Icon,
  className,
  ...rest
}: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border font-medium whitespace-nowrap',
        size === 'xs' ? 'h-4 px-1 text-2xs' : 'h-5 px-1.5 text-2xs',
        TONE[tone][variant],
        className
      )}
      {...rest}
    >
      {Icon ? <Icon aria-hidden strokeWidth={1.75} className="size-3" /> : null}
      {children}
    </span>
  )
}
