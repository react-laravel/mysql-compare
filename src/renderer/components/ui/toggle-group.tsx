import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useRovingTabIndex } from './_internal/useRovingTabIndex'

export interface ToggleOption<T extends string> {
  value: T
  label: React.ReactNode
  icon?: LucideIcon
  /** live count for a filter chip — wrap the row in aria-live where it streams */
  count?: number
  disabled?: boolean
}

export interface ToggleGroupProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  options: ToggleOption<T>[]
  variant?: 'segmented' | 'chips'
  size?: 'xs' | 'sm'
  className?: string
  'aria-label': string
}

/**
 * Mutually exclusive view modes (`segmented`) and filter chips with counts
 * (`chips`). One tab stop per group, arrows move within it.
 */
export function ToggleGroup<T extends string>({
  value,
  onValueChange,
  options,
  variant = 'segmented',
  size = 'sm',
  className,
  'aria-label': ariaLabel
}: ToggleGroupProps<T>) {
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  )
  const roving = useRovingTabIndex({
    count: options.length,
    orientation: 'horizontal',
    activeIndex,
    onActivate: (index) => {
      const option = options[index]
      if (option && !option.disabled) onValueChange(option.value)
    }
  })

  const height = size === 'xs' ? 'h-control-xs' : 'h-control-sm'
  const text = size === 'xs' ? 'text-2xs' : 'text-xs'

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      onKeyDown={roving.onKeyDown}
      className={cn(
        'inline-flex items-center',
        variant === 'segmented'
          ? 'gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5'
          : 'flex-wrap gap-1',
        className
      )}
    >
      {options.map((option, index) => {
        const Icon = option.icon
        const active = option.value === value
        return (
          <button
            key={option.value}
            ref={roving.register(index)}
            type="button"
            aria-pressed={active}
            disabled={option.disabled}
            tabIndex={roving.tabIndexFor(index)}
            onClick={() => onValueChange(option.value)}
            className={cn(
              height,
              text,
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2 transition-colors',
              'disabled:pointer-events-none disabled:opacity-50',
              variant === 'segmented'
                ? cn(
                    'rounded-md',
                    active
                      ? 'bg-surface font-medium text-fg shadow-raised'
                      : 'text-fg-muted hover:bg-hover hover:text-fg'
                  )
                : cn(
                    'rounded-sm border',
                    active
                      ? 'border-accent/40 bg-accent-quiet font-medium text-accent-text'
                      : 'border-border bg-surface text-fg-muted hover:bg-hover hover:text-fg'
                  )
            )}
          >
            {Icon ? <Icon aria-hidden strokeWidth={1.75} className="size-3" /> : null}
            {option.label}
            {option.count != null ? (
              <span className={cn('font-mono', active ? 'text-accent-text' : 'text-fg-subtle')}>
                {option.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
