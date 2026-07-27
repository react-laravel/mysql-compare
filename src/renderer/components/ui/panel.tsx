import * as React from 'react'
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: 'flat' | 'bordered' | 'inset'
  /** section heading; a plain string is styled, a node is rendered verbatim */
  header?: React.ReactNode
  headerActions?: React.ReactNode
  description?: React.ReactNode
  footer?: React.ReactNode
  padded?: boolean
  /** `danger` is the Danger Zone treatment */
  tone?: 'default' | 'danger'
  collapsible?: boolean
  defaultOpen?: boolean
  bodyClassName?: string
}

const VARIANT = {
  flat: 'bg-surface',
  bordered: 'border border-border bg-surface',
  inset: 'border border-border bg-inset'
} as const

/** Level-1 surface with optional header/footer slots. Never casts a shadow. */
export function Panel({
  variant = 'bordered',
  header,
  headerActions,
  description,
  footer,
  padded = true,
  tone = 'default',
  collapsible,
  defaultOpen = true,
  className,
  bodyClassName,
  children,
  ...rest
}: PanelProps) {
  const [open, setOpen] = React.useState(defaultOpen)
  const bodyId = React.useId()
  const danger = tone === 'danger'
  const Chevron = open ? ChevronDown : ChevronRight

  const heading = header ? (
    <div
      className={cn(
        'flex items-start gap-2 px-3 py-2',
        children || footer ? 'border-b border-border' : null,
        danger && 'border-danger/25'
      )}
    >
      {collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
          className="mt-0.5 shrink-0 text-fg-muted hover:text-fg"
        >
          <Chevron aria-hidden strokeWidth={1.75} className="size-3.5" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <h3
          className={cn(
            'flex items-center gap-1.5 text-sm font-medium',
            danger ? 'text-danger-text' : 'text-fg'
          )}
        >
          {danger ? <TriangleAlert aria-hidden strokeWidth={1.75} className="size-3.5" /> : null}
          {header}
        </h3>
        {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
      </div>
      {headerActions ? <div className="flex shrink-0 items-center gap-1">{headerActions}</div> : null}
    </div>
  ) : null

  return (
    <div
      data-tone={tone}
      className={cn(
        'flex min-w-0 flex-col rounded-lg',
        VARIANT[variant],
        danger && 'border-danger/30 bg-danger-quiet',
        className
      )}
      {...rest}
    >
      {heading}
      {children != null && (!collapsible || open) ? (
        <div id={bodyId} className={cn(padded && 'p-3', 'min-h-0', bodyClassName)}>
          {children}
        </div>
      ) : null}
      {footer ? (
        <div className={cn('border-t border-border px-3 py-2', danger && 'border-danger/25')}>
          {footer}
        </div>
      ) : null}
    </div>
  )
}
