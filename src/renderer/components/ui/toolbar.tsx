import * as React from 'react'
import { EllipsisVertical, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { DropdownMenu, type MenuItem } from './dropdown-menu'
import { IconButton } from './icon-button'
import { ProgressBar, type ProgressState } from './progress-bar'

export interface ToolbarProps {
  title?: React.ReactNode
  /** path, row count, connection — mono where it is a literal. Truncates. */
  subtitle?: React.ReactNode
  /**
   * Sits right of `subtitle` and never truncates — for the one signal in the
   * identity line that must survive a narrow window (a `Badge tone="warning"`
   * for a keyless table, the SQL console's selection hint). `subtitle` gives up
   * its characters first. Anything that may safely clip belongs in `subtitle`.
   */
  subtitleSlot?: React.ReactNode
  icon?: LucideIcon
  /** high-frequency only; cap at ~4 controls */
  actions?: React.ReactNode
  /** everything else, behind a single trailing ⋯ */
  overflow?: MenuItem[]
  overflowLabel?: string
  /** navigation such as pill Tabs, positioned by `centerPosition` */
  center?: React.ReactNode
  /** Keep navigation anchored to the title when contextual text varies. */
  centerPosition?: 'after-subtitle' | 'after-title'
  /** optional second row (30px) for filters / chips / breadcrumbs */
  filters?: React.ReactNode
  /** a 2px line pinned to the bottom edge — zero layout cost */
  progress?: ProgressState | null
  sticky?: boolean
  className?: string
}

/**
 * The anchor of the IA: `title` always renders, `actions` stays small, and the
 * running bar lives on the bottom edge so progress never shifts layout.
 */
export function Toolbar({
  title,
  subtitle,
  subtitleSlot,
  icon: Icon,
  actions,
  overflow,
  overflowLabel = 'More actions',
  center,
  centerPosition = 'after-subtitle',
  filters,
  progress,
  sticky = true,
  className
}: ToolbarProps) {
  const context = (
    <>
      {subtitle ? (
        <span className="truncate text-xs text-fg-muted" title={typeof subtitle === 'string' ? subtitle : undefined}>
          {subtitle}
        </span>
      ) : null}
      {subtitleSlot ? (
        <span className="flex shrink-0 items-center gap-1.5 self-center text-xs text-fg-muted">
          {subtitleSlot}
        </span>
      ) : null}
    </>
  )

  return (
    <div
      className={cn(
        'relative shrink-0 border-b border-border bg-surface',
        sticky && 'sticky top-0 z-[var(--ds-z-chrome)]',
        className
      )}
    >
      <div className="flex h-toolbar items-center gap-1.5 px-2">
        {Icon ? (
          <Icon aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-fg-muted" />
        ) : null}
        <div className={cn('flex min-w-0 items-baseline gap-2', centerPosition === 'after-title' && 'min-w-10 max-w-40')}>
          {title ? <h1 className="truncate text-sm font-semibold text-fg">{title}</h1> : null}
          {centerPosition === 'after-title' ? null : context}
        </div>
        {center ? <div className="ml-2 flex shrink-0 items-center">{center}</div> : null}
        {centerPosition === 'after-title' ? (
          <div className="ml-2 flex min-w-0 flex-1 items-center gap-2">
            {context}
          </div>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actions}
          {overflow?.length ? (
            <DropdownMenu
              items={overflow}
              side="bottom"
              align="end"
              aria-label={overflowLabel}
              trigger={
                <IconButton
                  icon={EllipsisVertical}
                  label={overflowLabel}
                  size="sm"
                  variant="ghost"
                  tooltipSide="left"
                />
              }
            />
          ) : null}
        </div>
      </div>
      {filters ? (
        <div className="flex min-h-[30px] flex-wrap items-center gap-1.5 border-t border-border px-2 py-1">
          {filters}
        </div>
      ) : null}
      {progress ? (
        <ProgressBar {...progress} variant="line" className="absolute inset-x-0 bottom-0" />
      ) : null}
    </div>
  )
}
