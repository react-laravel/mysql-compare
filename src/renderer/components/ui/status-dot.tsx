import * as React from 'react'
import { CircleCheck, CircleDashed, CircleSlash, CircleX, Loader2, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export type JobStatus = 'idle' | 'queued' | 'running' | 'done' | 'error' | 'cancelled'
export type StatusTone = 'success' | 'warning' | 'danger' | 'running' | 'idle'

export interface StatusDotProps {
  status: StatusTone
  size?: 'sm' | 'md'
  /** when present the dot renders with text and stops being aria-hidden */
  label?: React.ReactNode
  pulse?: boolean
  className?: string
}

const FILL: Record<StatusTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  running: 'bg-running',
  idle: 'bg-idle'
}

/** Reserved glyph per state (DESIGN-SYSTEM §6) — colour never travels alone. */
export const STATUS_ICON: Record<JobStatus, LucideIcon> = {
  idle: CircleDashed,
  queued: CircleDashed,
  running: Loader2,
  done: CircleCheck,
  error: CircleX,
  cancelled: CircleSlash
}

export const WARNING_ICON = TriangleAlert

/** Maps the job state machine onto the five status tones. */
export function statusTone(status: JobStatus): StatusTone {
  if (status === 'done') return 'success'
  if (status === 'error') return 'danger'
  if (status === 'running') return 'running'
  return 'idle'
}

export function StatusDot({
  status,
  size = 'sm',
  label,
  pulse = status === 'running',
  className
}: StatusDotProps) {
  const dot = (
    <span
      data-status={status}
      aria-hidden
      className={cn(
        'inline-block shrink-0 rounded-full',
        size === 'sm' ? 'size-1.5' : 'size-2',
        FILL[status],
        pulse && 'animate-pulse-dot',
        !label && className
      )}
    />
  )
  if (!label) return dot
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-fg-muted', className)}>
      {dot}
      {label}
    </span>
  )
}
