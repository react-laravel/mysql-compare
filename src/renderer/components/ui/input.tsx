import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/**
 * Shared field shell. The focus ring comes from the global `:focus-visible`
 * policy in tokens.css — never `outline-none` here.
 */
export const inputBase =
  'w-full rounded-md border bg-inset text-fg placeholder:text-fg-subtle ' +
  'transition-[border-color,box-shadow] duration-[120ms] ' +
  'border-border hover:border-border-strong ' +
  'disabled:cursor-not-allowed disabled:opacity-50 ' +
  'aria-invalid:border-danger'

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md'
  invalid?: boolean
  /** paths, globs, SQL literals */
  mono?: boolean
  leading?: LucideIcon | React.ReactNode
  trailing?: React.ReactNode
  /**
   * Classes for the wrapper. The wrapper only exists when `leading`/`trailing`
   * is set; `className` always lands on the `<input>` so callers keep sizing it.
   */
  containerClassName?: string
}

function isIconComponent(v: unknown): v is LucideIcon {
  return typeof v === 'function' || (typeof v === 'object' && v !== null && '$$typeof' in v)
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, containerClassName, size = 'md', invalid, mono, leading, trailing, ...rest },
  ref
) {
  const pad = size === 'sm' ? 'h-control-sm text-xs' : 'h-control-md text-sm'
  const control = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        inputBase,
        pad,
        mono && 'font-mono',
        leading ? 'pl-7' : 'pl-2',
        trailing ? 'pr-7' : 'pr-2',
        className
      )}
      {...rest}
    />
  )

  if (!leading && !trailing) return control

  const Lead = isIconComponent(leading) ? leading : null
  return (
    <div className={cn('relative flex items-center', containerClassName)}>
      {leading ? (
        <span className="pointer-events-none absolute left-2 flex text-fg-subtle">
          {Lead ? <Lead size={14} strokeWidth={1.75} aria-hidden /> : (leading as React.ReactNode)}
        </span>
      ) : null}
      {control}
      {trailing ? <span className="absolute right-1 flex items-center">{trailing}</span> : null}
    </div>
  )
})

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
  mono?: boolean
  resize?: 'none' | 'vertical'
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, mono, resize = 'vertical', rows = 8, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        inputBase,
        'px-2 py-1.5 text-sm',
        mono && 'font-mono',
        resize === 'none' ? 'resize-none' : 'resize-y',
        className
      )}
      {...rest}
    />
  )
})
