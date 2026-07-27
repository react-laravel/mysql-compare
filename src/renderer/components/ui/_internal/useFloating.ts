import * as React from 'react'

export type Side = 'top' | 'right' | 'bottom' | 'left'
export type Align = 'start' | 'center' | 'end'

export interface FloatingOptions {
  side?: Side
  align?: Align
  /** gap between the anchor and the floating element, px */
  offset?: number
  /** minimum distance kept from every viewport edge, px */
  padding?: number
  /** pointer-anchored placement (ContextMenu) — wins over `anchorRef` */
  anchorPoint?: { x: number; y: number } | null
  matchAnchorWidth?: boolean
  enabled?: boolean
}

export interface FloatingState {
  style: React.CSSProperties
  side: Side
  /** re-measure on demand (content grew, window scrolled) */
  update: () => void
}

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

function pointRect(x: number, y: number): Rect {
  return { left: x, top: y, right: x, bottom: y, width: 0, height: 0 }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.max(min, Math.min(value, max))
}

/**
 * Positioning + **viewport clamping** for every floating surface. This is the
 * one implementation: the four hand-rolled clampers it replaces used magic
 * numbers (216/184, 296/104) for the menu size instead of measuring it.
 *
 * Flips to the opposite side when the preferred side does not fit, then clamps
 * the cross axis so the surface never leaves the viewport.
 */
export function useFloating(
  anchorRef: React.RefObject<HTMLElement | null>,
  floatingRef: React.RefObject<HTMLElement | null>,
  {
    side = 'bottom',
    align = 'start',
    offset = 4,
    padding = 8,
    anchorPoint = null,
    matchAnchorWidth = false,
    enabled = true
  }: FloatingOptions = {}
): FloatingState {
  // Off-screen until the first layout-effect measurement lands (which happens
  // before paint), so the surface never flashes at the wrong position.
  const [state, setState] = React.useState<{ style: React.CSSProperties; side: Side }>({
    style: { position: 'fixed', left: -9999, top: -9999 },
    side
  })

  const pointX = anchorPoint?.x
  const pointY = anchorPoint?.y

  const update = React.useCallback(() => {
    if (!enabled) return
    const floating = floatingRef.current
    if (!floating) return
    if (typeof window === 'undefined') return

    const anchor: Rect | null =
      pointX != null && pointY != null
        ? pointRect(pointX, pointY)
        : (anchorRef.current?.getBoundingClientRect() ?? null)
    if (!anchor) return

    const width = matchAnchorWidth && anchor.width ? anchor.width : floating.offsetWidth
    const height = floating.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight

    const room = {
      top: anchor.top - padding,
      bottom: vh - anchor.bottom - padding,
      left: anchor.left - padding,
      right: vw - anchor.right - padding
    }
    const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

    let placed = side
    const needed = side === 'top' || side === 'bottom' ? height + offset : width + offset
    if (room[side] < needed && room[opposite[side]] > room[side]) placed = opposite[side]

    let left: number
    let top: number

    if (placed === 'bottom' || placed === 'top') {
      top = placed === 'bottom' ? anchor.bottom + offset : anchor.top - offset - height
      left =
        align === 'start'
          ? anchor.left
          : align === 'end'
            ? anchor.right - width
            : anchor.left + anchor.width / 2 - width / 2
    } else {
      left = placed === 'right' ? anchor.right + offset : anchor.left - offset - width
      top =
        align === 'start'
          ? anchor.top
          : align === 'end'
            ? anchor.bottom - height
            : anchor.top + anchor.height / 2 - height / 2
    }

    left = clamp(left, padding, vw - width - padding)
    top = clamp(top, padding, vh - height - padding)

    const style: React.CSSProperties = {
      position: 'fixed',
      left: Math.round(left),
      top: Math.round(top),
      maxHeight: Math.max(0, vh - 2 * padding),
      ...(matchAnchorWidth && anchor.width ? { width: anchor.width } : null)
    }

    setState((current) =>
      current.side === placed &&
      current.style.left === style.left &&
      current.style.top === style.top &&
      current.style.width === style.width
        ? current
        : { style, side: placed }
    )
  }, [align, anchorRef, enabled, floatingRef, matchAnchorWidth, offset, padding, pointX, pointY, side])

  React.useLayoutEffect(() => {
    if (!enabled) return
    update()
  }, [enabled, update])

  // Content that grows after the first measurement (a combobox list filtering,
  // a submenu opening) must be re-clamped, or the surface silently overflows
  // the viewport it was clamped into.
  React.useEffect(() => {
    if (!enabled) return
    const node = floatingRef.current
    if (!node) return
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => update())
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled, floatingRef, update])

  React.useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return
    const onViewportChange = () => update()
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [enabled, update])

  return { style: state.style, side: state.side, update }
}
