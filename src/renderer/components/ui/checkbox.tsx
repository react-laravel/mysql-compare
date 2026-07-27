import * as React from 'react'
import { cn } from '@renderer/lib/utils'

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  size?: 'sm' | 'md'
  /** tri-state — the grid "select all" needs it */
  indeterminate?: boolean
  label?: React.ReactNode
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, size = 'md', indeterminate, label, ...rest },
  ref
) {
  const inner = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate ?? false
  }, [indeterminate, rest.checked])

  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      inner.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref]
  )

  const box = (
    <input
      ref={setRefs}
      type="checkbox"
      aria-checked={indeterminate ? 'mixed' : undefined}
      className={cn(
        'shrink-0 rounded-sm border border-border bg-inset accent-[var(--ds-accent)]',
        size === 'sm' ? 'size-3' : 'size-3.5',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...rest}
    />
  )

  if (!label) return box
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-fg">
      {box}
      {label}
    </label>
  )
})
