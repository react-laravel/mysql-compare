import * as React from 'react'
import { CircleX, MousePointerClick, SearchX, Sparkles, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Kbd } from './kbd'

export type EmptyStateVariant = 'first-run' | 'no-selection' | 'no-results' | 'error'

export interface EmptyStateProps {
  variant?: EmptyStateVariant
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  /** REQUIRED — an empty state without a way out is a dead end (DS §7.6) */
  action: React.ReactNode
  secondaryAction?: React.ReactNode
  /** e.g. 'Mod+K' */
  shortcut?: string
  /** variant='error' → collapsed <details> with the message */
  error?: unknown
  detailsLabel?: string
  size?: 'sm' | 'md'
  className?: string
}

const DEFAULT_ICON: Record<EmptyStateVariant, LucideIcon> = {
  'first-run': Sparkles,
  'no-selection': MousePointerClick,
  'no-results': SearchX,
  error: CircleX
}

function errorText(error: unknown): string {
  if (error == null) return ''
  if (error instanceof Error) return error.stack ?? error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return String(error)
  }
}

/** No illustration, no dashed box, and the action is not optional. */
export function EmptyState({
  variant = 'first-run',
  icon,
  title,
  description,
  action,
  secondaryAction,
  shortcut,
  error,
  detailsLabel = 'Details',
  size = 'md',
  className
}: EmptyStateProps) {
  const Icon = icon ?? DEFAULT_ICON[variant]
  const message = variant === 'error' ? errorText(error) : ''

  return (
    <div
      data-empty={variant}
      role={variant === 'error' ? 'alert' : undefined}
      className={cn(
        'flex min-w-0 flex-col items-center justify-center gap-2 text-center',
        size === 'md' ? 'h-full p-8' : 'p-4',
        className
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className={cn('size-5 shrink-0', variant === 'error' ? 'text-danger' : 'text-fg-subtle')}
      />
      <div className={cn('font-medium text-fg', size === 'md' ? 'text-base' : 'text-sm')}>{title}</div>
      {description ? (
        <p className="max-w-md text-xs leading-5 text-fg-muted">{description}</p>
      ) : null}
      {message ? (
        <details className="max-w-md text-left">
          <summary className="cursor-pointer text-xs text-fg-muted">{detailsLabel}</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-border bg-inset p-2 text-2xs whitespace-pre-wrap break-words text-fg-muted">
            {message}
          </pre>
        </details>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        {action}
        {secondaryAction}
      </div>
      {shortcut ? (
        <div className="mt-1 text-xs text-fg-subtle">
          <Kbd>{shortcut}</Kbd>
        </div>
      ) : null}
    </div>
  )
}
