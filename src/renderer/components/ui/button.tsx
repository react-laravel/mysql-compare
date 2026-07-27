import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'danger-ghost'
  | 'link'

/** Maps to --ds-control-{xs,sm,md,lg} = 22 / 26 / 30 / 34px. */
export type ControlSize = 'xs' | 'sm' | 'md' | 'lg'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium select-none ' +
    'transition-colors duration-[120ms] ' +
    'disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active',
        secondary:
          'border border-border bg-surface text-fg hover:bg-hover hover:border-border-strong active:bg-active',
        ghost: 'text-fg-muted hover:bg-hover hover:text-fg active:bg-active',
        danger: 'bg-danger text-danger-fg hover:brightness-110 active:brightness-95',
        'danger-ghost': 'text-danger-text hover:bg-danger-quiet active:bg-danger-quiet',
        link: 'text-accent-text underline-offset-4 hover:underline px-0'
      },
      size: {
        xs: 'h-control-xs px-1.5 text-2xs [&_svg]:size-3',
        sm: 'h-control-sm px-2 text-xs [&_svg]:size-3.5',
        md: 'h-control-md px-2.5 text-sm [&_svg]:size-3.5',
        lg: 'h-control-lg px-3.5 text-sm [&_svg]:size-4'
      },
      fullWidth: { true: 'w-full', false: '' }
    },
    defaultVariants: { variant: 'secondary', size: 'md', fullWidth: false }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Leading icon; replaced by a spinner while `loading`. */
  icon?: LucideIcon
  trailingIcon?: LucideIcon
  /**
   * Sets `aria-busy` and swaps the leading icon for a spinner.
   * Deliberately does NOT disable — a cancellable action must stay clickable.
   */
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    fullWidth,
    icon: Icon,
    trailingIcon: Trailing,
    loading,
    children,
    ...rest
  },
  ref
) {
  const Lead = loading ? Loader2 : Icon
  return (
    <button
      ref={ref}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...rest}
    >
      {Lead ? (
        <Lead aria-hidden strokeWidth={1.75} className={loading ? 'animate-spin-slow' : undefined} />
      ) : null}
      {children}
      {Trailing && !loading ? <Trailing aria-hidden strokeWidth={1.75} /> : null}
    </button>
  )
})

export { buttonVariants }
