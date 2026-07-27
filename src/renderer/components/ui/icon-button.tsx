import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button, type ButtonProps } from './button'
import { Kbd } from './kbd'
import { Tooltip } from './tooltip'
import type { Side } from './_internal/useFloating'

export interface IconButtonProps
  extends Omit<ButtonProps, 'icon' | 'children' | 'fullWidth' | 'trailingIcon'> {
  icon: LucideIcon
  /** REQUIRED — becomes both `aria-label` and the tooltip body */
  label: string
  tooltip?: boolean
  tooltipSide?: Side
  /** rendered as a `Kbd` inside the tooltip */
  shortcut?: string
  /** toggle-button pressed state */
  active?: boolean
}

/**
 * Icon-only action. `label` is mandatory: an unlabeled icon button is how this
 * app ended up hiding Diff & Sync — its headline feature — behind a bare
 * `Database` + `ChevronDown`.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon,
    label,
    tooltip = true,
    tooltipSide = 'bottom',
    shortcut,
    active,
    size = 'md',
    className,
    disabled,
    ...rest
  },
  ref
) {
  const button = (
    <Button
      ref={ref}
      size={size}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn('aspect-square px-0', active && 'bg-selected text-fg', className)}
      {...rest}
    >
      <Icon aria-hidden strokeWidth={1.75} />
    </Button>
  )

  // A disabled button emits no pointer events, so the tooltip would never fire;
  // wrapping it in a span keeps the hint reachable.
  if (!tooltip) return button
  if (disabled) {
    return (
      <Tooltip
        side={tooltipSide}
        content={
          <>
            {label}
            {shortcut ? <Kbd>{shortcut}</Kbd> : null}
          </>
        }
      >
        <span className="inline-flex">{button}</span>
      </Tooltip>
    )
  }

  return (
    <Tooltip
      side={tooltipSide}
      content={
        <>
          {label}
          {shortcut ? <Kbd>{shortcut}</Kbd> : null}
        </>
      }
    >
      {button}
    </Tooltip>
  )
})
