import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/utils'
import { useFloating, type Side } from './_internal/useFloating'
import { usePortal } from './_internal/usePortal'

export interface TooltipProps {
  content: React.ReactNode
  side?: Side
  /** 400ms, or 0 when another tooltip was visible less than 300ms ago */
  delayMs?: number
  disabled?: boolean
  container?: HTMLElement | null
  children: React.ReactElement
}

/**
 * One module-level timer shared by every tooltip, so moving along a toolbar
 * shows the second one instantly. Never contains interactive content — that is
 * a `Popover`.
 */
let lastHiddenAt = 0

interface TriggerProps {
  ref?: React.Ref<HTMLElement>
  onMouseEnter?: (e: React.MouseEvent) => void
  onMouseLeave?: (e: React.MouseEvent) => void
  onFocus?: (e: React.FocusEvent) => void
  onBlur?: (e: React.FocusEvent) => void
}

export function Tooltip({
  content,
  side = 'bottom',
  delayMs = 400,
  disabled,
  container,
  children
}: TooltipProps) {
  const [open, setOpen] = React.useState(false)
  const anchorRef = React.useRef<HTMLElement | null>(null)
  const floatingRef = React.useRef<HTMLDivElement>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const target = usePortal(container)
  const { style } = useFloating(anchorRef, floatingRef, {
    side,
    align: 'center',
    offset: 6,
    enabled: open
  })

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  React.useEffect(() => clear, [])

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const show = () => {
    if (disabled) return
    clear()
    const wait = Date.now() - lastHiddenAt < 300 ? 0 : delayMs
    if (wait === 0) {
      setOpen(true)
      return
    }
    timer.current = setTimeout(() => setOpen(true), wait)
  }

  const hide = () => {
    clear()
    setOpen((wasOpen) => {
      if (wasOpen) lastHiddenAt = Date.now()
      return false
    })
  }

  const child = children as React.ReactElement<TriggerProps>
  // React 19 removed `element.ref`; the ref travels in props like anything else.
  const childRef = child.props.ref

  const trigger = React.cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node
      if (typeof childRef === 'function') childRef(node)
      else if (childRef && typeof childRef === 'object')
        (childRef as React.RefObject<HTMLElement | null>).current = node
    },
    onMouseEnter: (event: React.MouseEvent) => {
      child.props.onMouseEnter?.(event)
      show()
    },
    onMouseLeave: (event: React.MouseEvent) => {
      child.props.onMouseLeave?.(event)
      hide()
    },
    onFocus: (event: React.FocusEvent) => {
      child.props.onFocus?.(event)
      show()
    },
    onBlur: (event: React.FocusEvent) => {
      child.props.onBlur?.(event)
      hide()
    }
  })

  return (
    <>
      {trigger}
      {open && target
        ? createPortal(
            <div
              ref={floatingRef}
              role="tooltip"
              style={style}
              className={cn(
                'pointer-events-none z-[var(--ds-z-tooltip)] max-w-xs rounded-md border border-border-strong',
                'bg-raised px-2 py-1 text-xs text-fg shadow-raised',
                'inline-flex items-center gap-1.5'
              )}
            >
              {content}
            </div>,
            target
          )
        : null}
    </>
  )
}
