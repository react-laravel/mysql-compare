import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { inputBase } from './input'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  options: SelectOption[]
  size?: 'sm' | 'md'
  invalid?: boolean
  /** renders a disabled leading option */
  placeholder?: string
  /** classes for the wrapper that owns the chevron; `className` stays on the `<select>` */
  containerClassName?: string
}

/**
 * A themed native `<select>` — correct for <= 12 flat options and it keeps the
 * OS keyboard behaviour for free. The native chevron is inconsistent across
 * platforms, so it is suppressed with `appearance-none` and drawn here.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, className, containerClassName, size = 'md', invalid, placeholder, ...rest },
  ref
) {
  const pad = size === 'sm' ? 'h-control-sm text-xs' : 'h-control-md text-sm'
  return (
    <div className={cn('relative grid w-full items-center', containerClassName)}>
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          inputBase,
          pad,
          'col-start-1 row-start-1 appearance-none pl-2 pr-7',
          className
        )}
        {...rest}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        strokeWidth={1.75}
        className="pointer-events-none col-start-1 row-start-1 mr-2 size-3.5 justify-self-end text-fg-muted"
      />
    </div>
  )
})
