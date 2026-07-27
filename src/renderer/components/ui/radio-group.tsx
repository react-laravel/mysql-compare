import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export interface RadioOption<T extends string> {
  value: T
  label: React.ReactNode
  description?: React.ReactNode
  icon?: LucideIcon
  disabled?: boolean
}

export interface RadioGroupProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  options: RadioOption<T>[]
  variant?: 'list' | 'segmented'
  name: string
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}

/** 2–4 exclusive options. `segmented` is the theme-preference shape. */
export function RadioGroup<T extends string>({
  value,
  onValueChange,
  options,
  variant = 'list',
  name,
  size = 'md',
  className,
  'aria-label': ariaLabel
}: RadioGroupProps<T>) {
  const height = size === 'sm' ? 'h-control-sm' : 'h-control-md'

  if (variant === 'segmented') {
    return (
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className={cn('inline-flex gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5', className)}
      >
        {options.map((option) => {
          const Icon = option.icon
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={option.disabled}
              onClick={() => onValueChange(option.value)}
              className={cn(
                height,
                'inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 text-sm transition-colors',
                'disabled:pointer-events-none disabled:opacity-50',
                active
                  ? 'bg-surface font-medium text-fg shadow-raised'
                  : 'text-fg-muted hover:bg-hover hover:text-fg'
              )}
            >
              {Icon ? <Icon aria-hidden strokeWidth={1.75} className="size-3.5" /> : null}
              {option.label}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('flex flex-col gap-1', className)}>
      {options.map((option) => {
        const Icon = option.icon
        return (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-hover',
              option.disabled && 'pointer-events-none opacity-50'
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              disabled={option.disabled}
              onChange={() => onValueChange(option.value)}
              className="mt-0.5 size-3.5 shrink-0 accent-[var(--ds-accent)]"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm text-fg">
                {Icon ? <Icon aria-hidden strokeWidth={1.75} className="size-3.5" /> : null}
                {option.label}
              </span>
              {option.description ? (
                <span className="mt-0.5 block text-xs text-fg-muted">{option.description}</span>
              ) : null}
            </span>
          </label>
        )
      })}
    </div>
  )
}
