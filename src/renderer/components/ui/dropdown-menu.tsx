import * as React from 'react'
import { Check, ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Kbd } from './kbd'
import { Popover, type PopoverProps } from './popover'

export type MenuItem =
  | {
      kind?: 'item'
      id: string
      label: React.ReactNode
      icon?: LucideIcon
      shortcut?: string
      onSelect: () => void
      disabled?: boolean
      /** shown instead of executing — never a dead row (DS §8.2) */
      disabledReason?: string
      danger?: boolean
      hint?: React.ReactNode
    }
  | {
      kind: 'checkbox'
      id: string
      label: React.ReactNode
      checked: boolean
      onSelect: () => void
      disabled?: boolean
    }
  | { kind: 'separator'; id: string }
  | { kind: 'label'; id: string; label: React.ReactNode }
  | { kind: 'submenu'; id: string; label: React.ReactNode; icon?: LucideIcon; items: MenuItem[] }

export interface DropdownMenuProps extends Omit<PopoverProps, 'children' | 'role'> {
  items: MenuItem[]
  /** menu width; the four implementations this replaces used w-52/w-56/w-72 */
  width?: string
}

// The list itself is the focused element (one tab stop for the whole menu), so
// it must NOT paint a ring around all of the items — the *active item* carries
// the focus indication instead, and `aria-activedescendant` names it. This is
// the one sanctioned `outline-none` in the app; see `design-system-sweep.test.ts`.
const MENU_SURFACE = 'flex flex-col outline-none'

function isFocusable(item: MenuItem): boolean {
  if (item.kind === 'separator' || item.kind === 'label') return false
  if (item.kind === 'submenu') return true
  return !item.disabled
}

/**
 * `Popover` + `menu`/`menuitem` roles, arrow + Home/End navigation, type-ahead,
 * and an automatic separator before the first `danger` item.
 */
export function DropdownMenu({
  items,
  width = 'w-56',
  className,
  open: openProp,
  onOpenChange,
  ...rest
}: DropdownMenuProps) {
  const [openState, setOpenState] = React.useState(false)
  const open = openProp ?? openState
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next)
    onOpenChange?.(next)
  }

  // `role="menu"` lives on the list, not on the popover shell, so the element
  // that owns the arrow-key handler is the one assistive tech addresses.
  return (
    <Popover
      {...rest}
      role="presentation"
      haspopup="menu"
      aria-label={undefined}
      open={open}
      onOpenChange={setOpen}
      className={cn(width, 'p-1', className)}
    >
      <MenuList
        items={items}
        aria-label={rest['aria-label']}
        onClose={() => setOpen(false)}
      />
    </Popover>
  )
}

export function MenuList({
  items,
  onClose,
  level = 0,
  'aria-label': ariaLabel
}: {
  items: MenuItem[]
  onClose: () => void
  level?: number
  'aria-label'?: string
}) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const listId = React.useId()
  const rowId = (id: string) => `${listId}${id}`
  const [activeId, setActiveId] = React.useState<string | null>(
    () => items.find(isFocusable)?.id ?? null
  )
  const [openSubmenu, setOpenSubmenu] = React.useState<string | null>(null)
  const typeahead = React.useRef({ query: '', at: 0 })

  const focusable = items.filter(isFocusable)

  // Focus the list itself so arrow keys work without adding a tab stop per row.
  React.useEffect(() => {
    if (level > 0) return
    listRef.current?.focus({ preventScroll: true })
  }, [level])

  const moveTo = (index: number) => {
    const next = focusable[(index + focusable.length) % focusable.length]
    if (next) setActiveId(next.id)
  }

  const activeIndex = Math.max(
    0,
    focusable.findIndex((item) => item.id === activeId)
  )

  const select = (item: MenuItem) => {
    if (item.kind === 'separator' || item.kind === 'label' || item.kind === 'submenu') return
    if (item.disabled) return
    item.onSelect()
    onClose()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveTo(activeIndex + 1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveTo(activeIndex - 1)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      moveTo(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      moveTo(focusable.length - 1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const item = focusable[activeIndex]
      if (!item) return
      event.preventDefault()
      if (item.kind === 'submenu') {
        setOpenSubmenu(item.id)
        return
      }
      select(item)
      return
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now()
      const state = typeahead.current
      state.query = now - state.at > 700 ? event.key : state.query + event.key
      state.at = now
      const q = state.query.toLowerCase()
      const match = focusable.find((item) =>
        'label' in item && typeof item.label === 'string'
          ? item.label.toLowerCase().startsWith(q)
          : false
      )
      if (match) setActiveId(match.id)
    }
  }

  // A separator is implied before the first danger item so a destructive action
  // is never a mis-click away from a benign one.
  let dangerSeen = false

  return (
    <div
      ref={listRef}
      role={level === 0 ? 'menu' : 'group'}
      aria-label={ariaLabel}
      tabIndex={-1}
      aria-activedescendant={activeId ? rowId(activeId) : undefined}
      onKeyDown={onKeyDown}
      className={MENU_SURFACE}
    >
      {items.map((item) => {
        if (item.kind === 'separator') return <MenuSeparator key={item.id} />
        if (item.kind === 'label') {
          return (
            <div key={item.id} className="px-2 py-1 text-2xs font-medium text-fg-subtle uppercase">
              {item.label}
            </div>
          )
        }
        if (item.kind === 'submenu') {
          return (
            <SubmenuRow
              key={item.id}
              id={rowId(item.id)}
              item={item}
              active={activeId === item.id}
              open={openSubmenu === item.id}
              onOpenChange={(next) => setOpenSubmenu(next ? item.id : null)}
              onActivate={() => setActiveId(item.id)}
              onClose={onClose}
            />
          )
        }

        const danger = item.kind !== 'checkbox' && item.danger === true
        const needsSeparator = danger && !dangerSeen
        if (danger) dangerSeen = true

        return (
          <React.Fragment key={item.id}>
            {needsSeparator ? <MenuSeparator /> : null}
            <MenuRow
              id={rowId(item.id)}
              item={item}
              active={activeId === item.id}
              onActivate={() => setActiveId(item.id)}
              onSelect={() => select(item)}
            />
          </React.Fragment>
        )
      })}
    </div>
  )
}

function MenuSeparator() {
  return <div role="separator" className="my-1 h-px shrink-0 bg-border" />
}

const ROW =
  'flex w-full items-center gap-2 rounded-sm px-2 text-left text-sm h-control-sm ' +
  'transition-colors disabled:pointer-events-none disabled:opacity-50'

// The active row is the `aria-activedescendant` target, so it must look focused
// and not merely hovered — a wash alone would leave a keyboard user with no
// focus indicator anywhere in the menu (DS §5).
const ROW_ACTIVE_RING = 'outline-2 -outline-offset-2 outline-ring'

function MenuRow({
  id,
  item,
  active,
  onActivate,
  onSelect
}: {
  id: string
  item: Extract<MenuItem, { kind?: 'item' } | { kind: 'checkbox' }>
  active: boolean
  onActivate: () => void
  onSelect: () => void
}) {
  const checkbox = item.kind === 'checkbox'
  const danger = !checkbox && item.danger === true
  const Icon = !checkbox ? item.icon : undefined
  const disabledReason = !checkbox ? item.disabledReason : undefined

  return (
    <button
      type="button"
      id={id}
      role={checkbox ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={checkbox ? item.checked : undefined}
      aria-disabled={item.disabled || undefined}
      disabled={item.disabled}
      title={item.disabled ? disabledReason : undefined}
      data-focus-inset
      tabIndex={-1}
      onMouseEnter={onActivate}
      onClick={onSelect}
      className={cn(
        ROW,
        danger ? 'text-danger-text hover:bg-danger-quiet' : 'text-fg hover:bg-hover',
        active && [danger ? 'bg-danger-quiet' : 'bg-hover', ROW_ACTIVE_RING]
      )}
    >
      {checkbox ? (
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          {item.checked ? <Check aria-hidden strokeWidth={2} className="size-3.5" /> : null}
        </span>
      ) : Icon ? (
        <Icon aria-hidden strokeWidth={1.75} className={cn('size-3.5 shrink-0', !danger && 'text-fg-muted')} />
      ) : (
        <span className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {!checkbox && item.hint ? (
        <span className="shrink-0 text-xs text-fg-subtle">{item.hint}</span>
      ) : null}
      {!checkbox && item.shortcut ? <Kbd>{item.shortcut}</Kbd> : null}
    </button>
  )
}

function SubmenuRow({
  id,
  item,
  active,
  open,
  onOpenChange,
  onActivate,
  onClose
}: {
  id: string
  item: Extract<MenuItem, { kind: 'submenu' }>
  active: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onActivate: () => void
  onClose: () => void
}) {
  const Icon = item.icon
  return (
    <Popover
      role="menu"
      side="right"
      align="start"
      offset={2}
      open={open}
      onOpenChange={onOpenChange}
      className="w-56 p-1"
      trigger={
        <button
          type="button"
          id={id}
          role="menuitem"
          aria-haspopup="menu"
          data-focus-inset
          tabIndex={-1}
          onMouseEnter={onActivate}
          className={cn(ROW, 'text-fg hover:bg-hover', active && ['bg-hover', ROW_ACTIVE_RING])}
        >
          {Icon ? (
            <Icon aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-fg-muted" />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <ChevronRight aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-fg-muted" />
        </button>
      }
    >
      <MenuList
        items={item.items}
        level={1}
        aria-label={typeof item.label === 'string' ? item.label : undefined}
        onClose={() => {
          onOpenChange(false)
          onClose()
        }}
      />
    </Popover>
  )
}
