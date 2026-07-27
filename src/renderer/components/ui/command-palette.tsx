import * as React from 'react'
import { createPortal } from 'react-dom'
import { Search, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useDismiss } from './_internal/useDismiss'
import { useFocusTrap } from './_internal/useFocusTrap'
import { Kbd } from './kbd'

export type CommandGroup = 'navigate' | 'action' | 'open' | 'settings'

export interface Command {
  id: string
  title: string
  group: CommandGroup
  /** include the zh-CN synonyms so the palette matches either language */
  keywords?: string
  icon?: LucideIcon
  /** subtitle: the path, the connection, the tab */
  hint?: React.ReactNode
  shortcut?: string
  disabled?: boolean
  /** shown instead of executing — never a dead row */
  disabledReason?: string
  recentAt?: number
  perform: () => void | Promise<void>
}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: Command[]
  placeholder?: string
  emptyMessage?: React.ReactNode
  groupLabels?: Record<CommandGroup, React.ReactNode>
  footer?: React.ReactNode
  'aria-label'?: string
}

/** Fixed render order — the palette must not reshuffle under the user. */
const GROUP_ORDER: CommandGroup[] = ['navigate', 'action', 'open', 'settings']

/** Every query token must appear somewhere in the haystack. */
export function matchesQuery(command: Command, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = `${command.title} ${command.keywords ?? ''}`.toLowerCase()
  return tokens.every((token) => haystack.includes(token))
}

export function rankCommands(commands: Command[], query: string): Command[] {
  const matched = commands.filter((command) => matchesQuery(command, query))
  if (query.trim()) return matched
  // With an empty query: recents first, then everything else in registry order.
  return [...matched].sort((a, b) => (b.recentAt ?? 0) - (a.recentAt ?? 0))
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  placeholder,
  emptyMessage,
  groupLabels,
  footer,
  'aria-label': ariaLabel = 'Command palette'
}: CommandPaletteProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const rowRefs = React.useRef<Record<string, HTMLElement | null>>({})
  const [query, setQuery] = React.useState('')
  const [index, setIndex] = React.useState(0)

  useFocusTrap(ref, open, inputRef)
  useDismiss(ref, { enabled: open, onDismiss: () => onOpenChange(false) })

  React.useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
  }, [open])

  const ranked = React.useMemo(() => rankCommands(commands, query), [commands, query])

  const grouped = React.useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        items: ranked.filter((command) => command.group === group)
      })).filter((section) => section.items.length > 0),
    [ranked]
  )

  const flat = React.useMemo(() => grouped.flatMap((section) => section.items), [grouped])
  const active = flat[Math.min(index, Math.max(flat.length - 1, 0))]

  React.useEffect(() => {
    if (!active) return
    const row = rowRefs.current[active.id]
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (command: Command | undefined) => {
    if (!command || command.disabled) return
    onOpenChange(false)
    void command.perform()
  }

  if (!open) return null
  if (typeof document === 'undefined') return null

  let flatIndex = -1

  return createPortal(
    <div className="fixed inset-0 z-[var(--ds-z-palette)] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-overlay" aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="relative flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border-strong bg-raised shadow-overlay"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3">
          <Search aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-fg-muted" />
          <input
            ref={inputRef}
            value={query}
            role="combobox"
            aria-expanded
            aria-controls="ds-command-list"
            aria-activedescendant={active ? `ds-command-${active.id}` : undefined}
            placeholder={placeholder}
            // Inset so the 2px ring is not clipped by the palette's own
            // overflow-hidden — the ring is never suppressed (DS §5).
            data-focus-inset
            onChange={(event) => {
              setQuery(event.target.value)
              setIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setIndex((current) => (flat.length === 0 ? 0 : (current + 1) % flat.length))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setIndex((current) =>
                  flat.length === 0 ? 0 : (current - 1 + flat.length) % flat.length
                )
              } else if (event.key === 'Enter') {
                event.preventDefault()
                run(active)
              }
            }}
            className="h-toolbar min-w-0 flex-1 rounded-sm bg-transparent text-sm text-fg placeholder:text-fg-subtle"
          />
        </div>

        <div ref={listRef} id="ds-command-list" role="listbox" aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto p-1">
          {flat.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-fg-muted">{emptyMessage}</div>
          ) : (
            grouped.map((section) => (
              <div key={section.group}>
                <div className="px-2 py-1 text-2xs font-medium uppercase text-fg-subtle">
                  {groupLabels?.[section.group] ?? section.group}
                </div>
                {section.items.map((command) => {
                  flatIndex += 1
                  const current = flatIndex
                  const Icon = command.icon
                  const isActive = active?.id === command.id
                  return (
                    <button
                      key={command.id}
                      id={`ds-command-${command.id}`}
                      ref={(node) => {
                        rowRefs.current[command.id] = node
                      }}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      aria-disabled={command.disabled || undefined}
                      title={command.disabled ? command.disabledReason : undefined}
                      data-focus-inset
                      tabIndex={-1}
                      onMouseEnter={() => setIndex(current)}
                      onClick={() => run(command)}
                      className={cn(
                        'flex h-control-lg w-full items-center gap-2 rounded-md px-2 text-left text-sm',
                        command.disabled && 'opacity-50',
                        isActive ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
                      )}
                    >
                      {Icon ? (
                        <Icon aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0" />
                      ) : (
                        <span className="size-3.5 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{command.title}</span>
                      {command.hint ? (
                        <span className="shrink-0 text-xs text-fg-subtle">{command.hint}</span>
                      ) : null}
                      {command.shortcut ? <Kbd>{command.shortcut}</Kbd> : null}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {footer ? (
          <div className="shrink-0 border-t border-border px-3 py-1.5 text-xs text-fg-muted">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
