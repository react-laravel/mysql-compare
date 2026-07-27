import * as React from 'react'
import { Square } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { IconButton } from './icon-button'
import { STATUS_ICON, statusTone, type JobStatus } from './status-dot'

export type { JobStatus }

export interface ProgressState {
  status: JobStatus
  /** 0..1; absent while running means indeterminate */
  value?: number
  label?: React.ReactNode
  /** current table / file / step — mono, truncated */
  detail?: React.ReactNode
  count?: { done: number; total?: number }
  onCancel?: () => void
  cancelLabel?: string
}

export interface ProgressBarProps extends ProgressState {
  /** `bar` = 6px with labels · `line` = the 2px variant pinned under a Toolbar */
  variant?: 'bar' | 'line'
  className?: string
}

const FILL: Record<JobStatus, string> = {
  idle: 'bg-idle',
  queued: 'bg-idle',
  running: 'bg-running',
  done: 'bg-success',
  error: 'bg-danger',
  cancelled: 'bg-idle'
}

/**
 * §7. Cancel always lives with the progress, never elsewhere. Indeterminate
 * carries `data-indeterminate` so the reduced-motion block can swap the
 * translation for a static striped fill.
 */
export function ProgressBar({
  status,
  value,
  label,
  detail,
  count,
  onCancel,
  cancelLabel = 'Cancel',
  variant = 'bar',
  className
}: ProgressBarProps) {
  const running = status === 'running'
  const ratio =
    value != null
      ? value
      : count && count.total
        ? count.done / Math.max(count.total, 1)
        : undefined
  const indeterminate = running && ratio == null
  const percent = ratio == null ? 0 : Math.round(Math.min(Math.max(ratio, 0), 1) * 100)
  const Icon = STATUS_ICON[status]

  const track = (
    <div
      role="progressbar"
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      aria-valuenow={indeterminate ? undefined : percent}
      aria-busy={running || undefined}
      data-status={status}
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-surface-2',
        variant === 'line' ? 'h-0.5 rounded-none' : 'h-1.5'
      )}
    >
      {indeterminate ? (
        <div
          data-indeterminate="true"
          className={cn('absolute inset-y-0 left-0 w-full animate-indeterminate', FILL[status])}
        />
      ) : (
        <div
          className={cn('h-full transition-[width] duration-[180ms]', FILL[status])}
          style={{ width: `${percent}%` }}
        />
      )}
    </div>
  )

  if (variant === 'line') return <div className={className}>{track}</div>

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div className="flex min-w-0 items-center gap-1.5 text-xs" aria-live="polite">
        <Icon
          aria-hidden
          strokeWidth={1.75}
          className={cn('size-3.5 shrink-0', running && 'animate-spin-slow', {
            success: 'text-success',
            warning: 'text-warning',
            danger: 'text-danger',
            running: 'text-running',
            idle: 'text-idle'
          }[statusTone(status)])}
        />
        {label ? <span className="shrink-0 text-fg">{label}</span> : null}
        {detail ? <span className="min-w-0 truncate font-mono text-fg-muted">{detail}</span> : null}
        {count ? (
          <span className="ml-auto shrink-0 font-mono text-fg-muted">
            {count.total != null ? `${count.done} / ${count.total}` : count.done}
          </span>
        ) : null}
        {onCancel ? (
          <IconButton
            icon={Square}
            label={cancelLabel}
            size="xs"
            variant="danger-ghost"
            className={count ? undefined : 'ml-auto'}
            onClick={onCancel}
          />
        ) : null}
      </div>
      {track}
    </div>
  )
}
