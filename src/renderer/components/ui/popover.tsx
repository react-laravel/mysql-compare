import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/utils'
import { useControllable } from './_internal/useControllable'
import { useDismiss } from './_internal/useDismiss'
import { useFloating, type Align, type Side } from './_internal/useFloating'
import { usePortal } from './_internal/usePortal'

export type { Align, Side }

export interface PopoverProps {
  /** omit for an uncontrolled popover driven by the trigger */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** must accept a ref and an onClick — usually a Button/IconButton */
  trigger?: React.ReactElement
  side?: Side
  align?: Align
  offset?: number
  /** pointer-anchored placement (ContextMenu); makes `trigger` optional */
  anchorPoint?: { x: number; y: number } | null
  matchTriggerWidth?: boolean
  /**
   * A popover opened from inside a `Dialog` must be portalled into the dialog
   * element, not the body, so it inherits the dialog's stacking context.
   */
  container?: HTMLElement | null
  className?: string
  'aria-label'?: string
  role?: string
  /** what the trigger announces it opens; defaults from `role` */
  haspopup?: 'menu' | 'dialog' | 'listbox' | 'tree' | 'grid'
  children: React.ReactNode
}

interface TriggerProps {
  ref?: React.Ref<HTMLElement>
  onClick?: (e: React.MouseEvent) => void
  'aria-expanded'?: boolean
  'aria-haspopup'?: string
}

/** Positioned floating surface with viewport clamping, outside-click and Esc. */
export function Popover({
  open: openProp,
  onOpenChange,
  trigger,
  side = 'bottom',
  align = 'start',
  offset = 4,
  anchorPoint = null,
  matchTriggerWidth,
  container,
  className,
  role = 'dialog',
  haspopup,
  'aria-label': ariaLabel,
  children
}: PopoverProps) {
  const [open, setOpen] = useControllable(openProp, false, onOpenChange)
  const anchorRef = React.useRef<HTMLElement | null>(null)
  const floatingRef = React.useRef<HTMLDivElement>(null)

  // A popover opened from inside a dialog is portalled into the dialog element
  // so it inherits that stacking context — the z ladder puts popovers (40)
  // below dialogs (50), so portalling to the body would hide it behind one.
  const [inheritedContainer, setInheritedContainer] = React.useState<HTMLElement | null>(null)
  React.useEffect(() => {
    if (container !== undefined || !open) return
    setInheritedContainer(anchorRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null)
  }, [container, open])

  const target = usePortal(container ?? inheritedContainer)

  const { style } = useFloating(anchorRef, floatingRef, {
    side,
    align,
    offset,
    anchorPoint,
    matchAnchorWidth: matchTriggerWidth,
    enabled: open
  })

  useDismiss(floatingRef, {
    enabled: open,
    // The trigger counts as "inside": otherwise pointerdown closes and the
    // trigger's own click immediately re-opens.
    ignore: [anchorRef],
    onDismiss: () => {
      setOpen(false)
      // Return focus to the trigger so Esc never strands the keyboard user.
      anchorRef.current?.focus?.()
    }
  })

  const child = trigger as React.ReactElement<TriggerProps> | undefined
  // React 19 removed `element.ref`; the ref travels in props like anything else.
  const childRef = child?.props.ref

  const renderedTrigger = child
    ? React.cloneElement(child, {
        ref: (node: HTMLElement | null) => {
          anchorRef.current = node
          if (typeof childRef === 'function') childRef(node)
          else if (childRef && typeof childRef === 'object')
            (childRef as React.RefObject<HTMLElement | null>).current = node
        },
        'aria-expanded': open,
        'aria-haspopup': haspopup ?? (role === 'menu' ? 'menu' : 'dialog'),
        onClick: (event: React.MouseEvent) => {
          child.props.onClick?.(event)
          if (event.defaultPrevented) return
          setOpen(!open)
        }
      })
    : null

  return (
    <>
      {renderedTrigger}
      {open && target
        ? createPortal(
            <div
              ref={floatingRef}
              role={role}
              aria-label={ariaLabel}
              style={style}
              className={cn(
                'z-[var(--ds-z-popover)] overflow-auto rounded-lg border border-border-strong',
                'bg-raised shadow-raised',
                className
              )}
            >
              {children}
            </div>,
            target
          )
        : null}
    </>
  )
}
