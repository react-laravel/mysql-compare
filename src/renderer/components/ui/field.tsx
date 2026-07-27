import * as React from 'react'
import { cn } from '@renderer/lib/utils'

interface FieldControlProps {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

export interface FieldProps {
  label: React.ReactNode
  /** omit to auto-generate via useId */
  htmlFor?: string
  hint?: React.ReactNode
  /** when set, the control gets aria-invalid and the message is rendered in danger ink */
  error?: React.ReactNode
  required?: boolean
  orientation?: 'vertical' | 'horizontal'
  className?: string
  children: React.ReactNode
}

/** Label + control + hint/error, wired with `aria-describedby`. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  orientation = 'vertical',
  className,
  children
}: FieldProps) {
  const auto = React.useId()
  const id = htmlFor ?? auto
  const msgId = `${id}-msg`
  const described = hint || error ? msgId : undefined

  const control = React.isValidElement<FieldControlProps>(children)
    ? React.cloneElement(children, {
        id: children.props.id ?? id,
        'aria-describedby': children.props['aria-describedby'] ?? described,
        'aria-invalid': children.props['aria-invalid'] ?? (error ? true : undefined)
      })
    : children

  return (
    <div
      className={cn(
        'gap-1',
        orientation === 'vertical'
          ? 'flex flex-col'
          : 'grid grid-cols-[140px_1fr] items-center gap-x-3',
        className
      )}
    >
      <label htmlFor={id} className="text-xs font-medium text-fg-muted">
        {label}
        {required ? <span className="ml-0.5 text-danger-text">*</span> : null}
      </label>
      {control}
      {hint || error ? (
        <p id={msgId} className={cn('text-xs', error ? 'text-danger-text' : 'text-fg-subtle')}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  )
}
