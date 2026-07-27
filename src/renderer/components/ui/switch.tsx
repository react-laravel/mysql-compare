import * as React from 'react'
import { cn } from '@renderer/lib/utils'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  size?: 'sm' | 'md'
  label?: React.ReactNode
  description?: React.ReactNode
  disabled?: boolean
  id?: string
  className?: string
}

/**
 * Immediate-effect boolean (wrap lines, dark mode, colourblind diff). Never
 * inside a form that has a Save button — that is a `Checkbox`.
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, size = 'md', label, description, disabled, id, className },
  ref
) {
  const auto = React.useId()
  const controlId = id ?? auto
  const track = size === 'sm' ? 'h-3.5 w-6' : 'h-4 w-7'
  const thumb = size === 'sm' ? 'size-2.5' : 'size-3'
  const shift = size === 'sm' ? 'translate-x-2.5' : 'translate-x-3'

  const control = (
    <button
      ref={ref}
      id={controlId}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border p-0.5 transition-colors duration-[120ms]',
        track,
        checked ? 'border-accent bg-accent' : 'border-border bg-inset',
        disabled && 'pointer-events-none opacity-50',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'block rounded-full transition-transform duration-[120ms]',
          thumb,
          checked ? cn('bg-accent-fg', shift) : 'translate-x-0 bg-fg-subtle'
        )}
      />
    </button>
  )

  if (!label && !description) return control

  return (
    <div className="flex items-start gap-2">
      {control}
      <div className="min-w-0">
        <label htmlFor={controlId} className="block text-sm text-fg">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
      </div>
    </div>
  )
})
