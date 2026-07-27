import * as React from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from './button'
import { IconButton } from './icon-button'
import { Input } from './input'
import { Popover } from './popover'
import { Spinner } from './spinner'

export interface ComboboxProps<T> {
  items: T[]
  value: T | null
  onValueChange: (value: T | null) => void
  itemKey: (item: T) => string
  itemLabel: (item: T) => string
  renderItem?: (item: T, state: { active: boolean; selected: boolean }) => React.ReactNode
  filter?: (item: T, query: string) => boolean
  groupBy?: (item: T) => string
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: React.ReactNode
  size?: 'sm' | 'md'
  clearable?: boolean
  clearLabel?: string
  loading?: boolean
  disabled?: boolean
  className?: string
  container?: HTMLElement | null
  'aria-label'?: string
}

/**
 * More than ~12 options, or anything searchable/grouped. `Select` stays the
 * right answer for a short flat list.
 */
export function Combobox<T>({
  items,
  value,
  onValueChange,
  itemKey,
  itemLabel,
  renderItem,
  filter,
  groupBy,
  placeholder = '',
  searchPlaceholder = '',
  emptyMessage,
  size = 'md',
  clearable,
  clearLabel = 'Clear',
  loading,
  disabled,
  className,
  container,
  'aria-label': ariaLabel
}: ComboboxProps<T>) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)
  const listId = React.useId()

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    const match = filter ?? ((item: T, needle: string) => itemLabel(item).toLowerCase().includes(needle))
    return items.filter((item) => match(item, q))
  }, [filter, itemLabel, items, query])

  React.useEffect(() => {
    setActiveIndex(0)
  }, [query, open])

  const groups = React.useMemo(() => {
    if (!groupBy) return [{ key: '', items: matches }]
    const byKey = new Map<string, T[]>()
    for (const item of matches) {
      const key = groupBy(item)
      const bucket = byKey.get(key)
      if (bucket) bucket.push(item)
      else byKey.set(key, [item])
    }
    return Array.from(byKey, ([key, groupItems]) => ({ key, items: groupItems }))
  }, [groupBy, matches])

  const commit = (item: T | null) => {
    onValueChange(item)
    setOpen(false)
    setQuery('')
  }

  const height = size === 'sm' ? 'h-control-sm text-xs' : 'h-control-md text-sm'
  let flatIndex = -1

  // The clear affordance is a sibling of the trigger, never a nested <button>.
  return (
    <div className={cn('relative flex min-w-0 items-center', className)}>
      {clearable && value ? (
        <IconButton
          icon={X}
          label={clearLabel}
          size="xs"
          variant="ghost"
          tooltip={false}
          disabled={disabled}
          className="absolute right-6 z-[1]"
          onClick={() => onValueChange(null)}
        />
      ) : null}
      <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      haspopup="listbox"
      matchTriggerWidth
      container={container}
      className="max-h-72 w-full min-w-56 p-1"
      aria-label={ariaLabel}
      trigger={
        <Button
          type="button"
          variant="secondary"
          size={size}
          disabled={disabled}
          role="combobox"
          aria-controls={listId}
          aria-label={ariaLabel}
          className={cn(height, 'w-full justify-between gap-1 font-normal', clearable && value && 'pr-11')}
        >
          <span className={cn('min-w-0 truncate', !value && 'text-fg-subtle')}>
            {value ? itemLabel(value) : placeholder}
          </span>
          <ChevronDown aria-hidden strokeWidth={1.75} className="shrink-0 text-fg-muted" />
        </Button>
      }
    >
      <div className="flex flex-col gap-1">
        <Input
          autoFocus
          size="sm"
          leading={Search}
          value={query}
          placeholder={searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((i) => (matches.length ? (i + 1) % matches.length : 0))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const item = matches[activeIndex]
              if (item) commit(item)
            }
          }}
        />
        <div id={listId} role="listbox" aria-label={ariaLabel} className="min-h-0 overflow-y-auto">
          {loading ? (
            <div className="px-2 py-3">
              <Spinner size="sm" label="…" />
            </div>
          ) : matches.length === 0 ? (
            <div className="px-2 py-3 text-xs text-fg-muted">{emptyMessage}</div>
          ) : (
            groups.map((group) => (
              <div key={group.key || 'all'}>
                {group.key ? (
                  <div className="px-2 py-1 text-2xs font-medium uppercase text-fg-subtle">
                    {group.key}
                  </div>
                ) : null}
                {group.items.map((item) => {
                  flatIndex += 1
                  const index = flatIndex
                  const selected = value != null && itemKey(value) === itemKey(item)
                  const active = index === activeIndex
                  return (
                    <button
                      key={itemKey(item)}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-focus-inset
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => commit(item)}
                      className={cn(
                        'flex h-control-sm w-full items-center gap-2 rounded-sm px-2 text-left text-sm',
                        active ? 'bg-hover text-fg' : 'text-fg-muted hover:text-fg'
                      )}
                    >
                      <span className="flex size-3.5 shrink-0 items-center justify-center">
                        {selected ? <Check aria-hidden strokeWidth={2} className="size-3.5" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {renderItem ? renderItem(item, { active, selected }) : itemLabel(item)}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
      </Popover>
    </div>
  )
}
