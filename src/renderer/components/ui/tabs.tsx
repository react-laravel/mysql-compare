import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export interface TabItem {
  value: string
  label: React.ReactNode
  icon?: LucideIcon
  badge?: React.ReactNode
  disabled?: boolean
}

export interface TabsProps {
  value: string
  onValueChange: (v: string) => void
  items: TabItem[]
  variant?: 'underline' | 'pill'
  size?: 'sm' | 'md'
  className?: string
  /** REQUIRED — a tablist without a name is unusable with a screen reader. */
  'aria-label': string
}

/**
 * View switching with the full `tablist`/`tab` ARIA contract and roving
 * tabIndex: one tab stop for the group, arrows move within it.
 */
export function Tabs({
  value,
  onValueChange,
  items,
  variant = 'underline',
  size = 'md',
  className,
  'aria-label': ariaLabel
}: TabsProps) {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({})

  const move = (from: number, delta: number) => {
    const enabled = items.filter((it) => !it.disabled)
    if (enabled.length === 0) return
    const currentEnabledIndex = enabled.findIndex((it) => it.value === items[from]?.value)
    const base = currentEnabledIndex === -1 ? 0 : currentEnabledIndex
    const next = enabled[(base + delta + enabled.length) % enabled.length]
    if (!next) return
    onValueChange(next.value)
    refs.current[next.value]?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      move(index, 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(index, -1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      const first = items.find((it) => !it.disabled)
      if (first) {
        onValueChange(first.value)
        refs.current[first.value]?.focus()
      }
    } else if (event.key === 'End') {
      event.preventDefault()
      const last = [...items].reverse().find((it) => !it.disabled)
      if (last) {
        onValueChange(last.value)
        refs.current[last.value]?.focus()
      }
    }
  }

  const height = size === 'sm' ? 'h-control-sm' : 'h-control-md'

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'flex overflow-x-auto',
        variant === 'underline' ? 'border-b border-border' : 'gap-1 rounded-lg bg-surface-2 p-0.5',
        className
      )}
    >
      {items.map((item, index) => {
        const active = item.value === value
        const Icon = item.icon
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[item.value] = el
            }}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={item.disabled || undefined}
            disabled={item.disabled}
            tabIndex={active ? 0 : -1}
            data-focus-inset
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => !item.disabled && onValueChange(item.value)}
            className={cn(
              height,
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm transition-colors',
              'disabled:pointer-events-none disabled:opacity-50',
              variant === 'underline'
                ? cn(
                    '-mb-px border-b-2',
                    active
                      ? 'border-accent font-medium text-fg'
                      : 'border-transparent text-fg-muted hover:text-fg'
                  )
                : cn(
                    'rounded-md',
                    active
                      ? 'bg-surface font-medium text-fg shadow-raised'
                      : 'text-fg-muted hover:bg-hover hover:text-fg'
                  )
            )}
          >
            {Icon ? <Icon aria-hidden strokeWidth={1.75} className="size-3.5" /> : null}
            {item.label}
            {item.badge}
          </button>
        )
      })}
    </div>
  )
}
