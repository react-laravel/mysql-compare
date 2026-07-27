import * as React from 'react'
import { ChevronDown, ChevronRight, EllipsisVertical, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { Tone } from './badge'
import { DropdownMenu, type MenuItem } from './dropdown-menu'
import { IconButton } from './icon-button'
import { StatusDot, type StatusTone } from './status-dot'

export interface TreeRowProps {
  depth: number
  label: React.ReactNode
  icon?: LucideIcon
  iconTone?: Tone
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  selected?: boolean
  status?: StatusTone
  /** right-aligned counts / size / age */
  meta?: React.ReactNode
  badges?: React.ReactNode
  /** revealed on hover AND focus-within — never hover alone */
  actions?: React.ReactNode
  /** persistent ⋯ so the actions stay discoverable */
  overflow?: MenuItem[]
  overflowLabel?: string
  onActivate?: () => void
  onContextMenu?: (event: React.MouseEvent) => void
  /** inline rename */
  editing?: { value: string; onCommit: (value: string) => void; onCancel: () => void }
  guides?: boolean
  className?: string
  title?: string
  tabIndex?: number
  onKeyDown?: (event: React.KeyboardEvent) => void
  /** roving tabIndex owners follow focus, including focus the user takes by click */
  onFocus?: (event: React.FocusEvent) => void
  setSize?: number
  posInSet?: number
}

const ICON_TONE: Record<Tone, string> = {
  neutral: 'text-fg-muted',
  accent: 'text-accent-text',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  running: 'text-running',
  idle: 'text-idle'
}

/**
 * One row renderer for every tree in the app. `role="treeitem"` + `aria-level`
 * + `aria-expanded` + `aria-selected`, indent at `depth * 12 + 8`, and actions
 * revealed on `group-hover` **and** `group-focus-within`.
 */
export const TreeRow = React.forwardRef<HTMLDivElement, TreeRowProps>(function TreeRow(
  {
    depth,
    label,
    icon: Icon,
    iconTone = 'neutral',
    expandable,
    expanded,
    onToggle,
    selected,
    status,
    meta,
    badges,
    actions,
    overflow,
    overflowLabel = 'More actions',
    onActivate,
    onContextMenu,
    editing,
    guides = true,
    className,
    title,
    tabIndex,
    onKeyDown,
    onFocus,
    setSize,
    posInSet
  },
  ref
) {
  const Chevron = expanded ? ChevronDown : ChevronRight
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [draft, setDraft] = React.useState(editing?.value ?? '')

  React.useEffect(() => {
    if (!editing) return
    setDraft(editing.value)
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [editing])

  return (
    <div
      ref={ref}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={expandable ? Boolean(expanded) : undefined}
      aria-selected={selected || undefined}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      tabIndex={tabIndex}
      title={title}
      data-focus-inset
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onContextMenu={onContextMenu}
      onClick={(event) => {
        if (editing) return
        if ((event.target as HTMLElement).closest('[data-tree-action]')) return
        onActivate?.()
      }}
      style={{ paddingLeft: depth * 12 + 8 }}
      className={cn(
        'group relative flex h-row-tree min-w-0 items-center gap-1 pr-1 text-sm',
        'border-l-2 border-transparent',
        selected ? 'border-l-accent bg-selected text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
        onActivate && !editing && 'cursor-pointer',
        className
      )}
    >
      {guides && depth > 0 ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 border-l border-border/60"
          style={{ left: (depth - 1) * 12 + 12 }}
        />
      ) : null}

      {expandable ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          data-tree-action
          data-focus-inset
          onClick={(event) => {
            event.stopPropagation()
            onToggle?.()
          }}
          className="flex size-4 shrink-0 items-center justify-center rounded-xs text-fg-subtle hover:text-fg"
        >
          <Chevron strokeWidth={1.75} className="size-3" />
        </button>
      ) : (
        <span className="size-4 shrink-0" />
      )}

      {status ? (
        <StatusDot status={status} className="mx-0.5" />
      ) : Icon ? (
        <Icon aria-hidden strokeWidth={1.75} className={cn('size-3.5 shrink-0', ICON_TONE[iconTone])} />
      ) : null}

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onBlur={() => editing.onCommit(draft)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              editing.onCommit(draft)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              editing.onCancel()
            }
          }}
          className="min-w-0 flex-1 rounded-xs border border-border-strong bg-inset px-1 text-sm text-fg"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}

      {badges}
      {meta ? <span className="shrink-0 text-2xs text-fg-subtle">{meta}</span> : null}

      {actions ? (
        <span
          data-tree-action
          className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {actions}
        </span>
      ) : null}

      {overflow?.length ? (
        <span data-tree-action className="shrink-0">
          <DropdownMenu
            items={overflow}
            side="bottom"
            align="end"
            aria-label={overflowLabel}
            trigger={
              <IconButton
                icon={EllipsisVertical}
                label={overflowLabel}
                size="xs"
                variant="ghost"
                tooltip={false}
                onClick={(event) => event.stopPropagation()}
              />
            }
          />
        </span>
      ) : null}
    </div>
  )
})
