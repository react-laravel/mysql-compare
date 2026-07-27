import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button, type ButtonProps } from './button'
import { DropdownMenu, type MenuItem } from './dropdown-menu'

export interface SplitButtonProps extends Omit<ButtonProps, 'trailingIcon'> {
  /** the default action's label */
  children: React.ReactNode
  items: MenuItem[]
  menuLabel: string
  container?: HTMLElement | null
}

/** Primary action plus a menu of variants ("Upload ▾", "New ▾"). */
export const SplitButton = React.forwardRef<HTMLButtonElement, SplitButtonProps>(
  function SplitButton(
    { children, items, menuLabel, container, size = 'md', variant = 'secondary', className, ...rest },
    ref
  ) {
    return (
      <div className={cn('inline-flex items-stretch', className)}>
        <Button
          ref={ref}
          size={size}
          variant={variant}
          className="rounded-r-none"
          {...rest}
        >
          {children}
        </Button>
        <DropdownMenu
          items={items}
          side="bottom"
          align="end"
          container={container}
          aria-label={menuLabel}
          trigger={
            <Button
              size={size}
              variant={variant}
              aria-label={menuLabel}
              className="-ml-px rounded-l-none px-1"
            >
              <ChevronDown aria-hidden strokeWidth={1.75} />
            </Button>
          }
        />
      </div>
    )
  }
)
