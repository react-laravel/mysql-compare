import * as React from 'react'
import { cn } from '@renderer/lib/utils'

export interface SplitPaneProps {
  /** `horizontal` = side by side, the divider moves left/right */
  direction?: 'horizontal' | 'vertical'
  /** persists the ratio in localStorage */
  storageKey?: string
  /** 0..1 of the container along the split axis */
  defaultRatio?: number
  /** px bounds on the first pane */
  min?: number
  max?: number
  /** which pane `collapsed` folds away; `null` disables Enter-to-collapse */
  collapsible?: 'first' | 'second' | null
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  /** px width/height of the collapsed pane — 44px icon rail, not 0 */
  collapsedSize?: number
  label: string
  className?: string
  children: [React.ReactNode, React.ReactNode]
}

const KEY_STEP = 8
const KEY_STEP_LARGE = 32

function readRatio(storageKey: string | undefined, fallback: number): number {
  if (!storageKey) return fallback
  if (typeof localStorage === 'undefined') return fallback
  const raw = localStorage.getItem(storageKey)
  const parsed = raw == null ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : fallback
}

/**
 * Drag **and keyboard** resize. The divider is a real `role="separator"` with
 * `aria-valuemin/max/now`, arrows (±8px, ±32px with Shift), Home/End and
 * double-click to reset. Zero transition while dragging — direct manipulation
 * must not lag the pointer.
 */
export function SplitPane({
  direction = 'horizontal',
  storageKey,
  defaultRatio = 0.5,
  min = 120,
  max,
  collapsible = null,
  collapsed = false,
  onCollapsedChange,
  collapsedSize = 44,
  label,
  className,
  children
}: SplitPaneProps) {
  const horizontal = direction === 'horizontal'
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [ratio, setRatio] = React.useState(() => readRatio(storageKey, defaultRatio))
  const [total, setTotal] = React.useState(0)
  const dragging = React.useRef(false)

  React.useEffect(() => {
    if (!storageKey) return
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(storageKey, String(ratio))
  }, [ratio, storageKey])

  React.useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const measure = () => setTotal(horizontal ? node.clientWidth : node.clientHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [horizontal])

  const upperBound = React.useMemo(() => {
    const hard = max ?? Number.POSITIVE_INFINITY
    if (total === 0) return hard
    return Math.min(hard, Math.max(min, total - min))
  }, [max, min, total])

  const clampPx = React.useCallback(
    (px: number) => Math.min(upperBound, Math.max(min, px)),
    [min, upperBound]
  )

  // `collapsible` names *which* pane the `collapsed` flag folds away. The
  // second-pane branch is what the SQL console's ⌘J needs: the results pane
  // folds to the divider and the editor takes the whole container.
  const secondCollapsed = collapsed && collapsible === 'second'
  const firstCollapsed = collapsed && !secondCollapsed
  const firstPx = firstCollapsed
    ? collapsedSize
    : total === 0
      ? undefined
      : clampPx(total * ratio)

  const setPx = React.useCallback(
    (px: number) => {
      if (total === 0) return
      setRatio(clampPx(px) / total)
    },
    [clampPx, total]
  )

  React.useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragging.current) return
      const node = containerRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      setPx(horizontal ? event.clientX - rect.left : event.clientY - rect.top)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [horizontal, setPx])

  const currentPx = firstPx ?? min

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    const back = horizontal ? 'ArrowLeft' : 'ArrowUp'
    const forward = horizontal ? 'ArrowRight' : 'ArrowDown'
    // While a pane is folded away the arrows would move a ratio nobody can
    // see; Enter (expand) is the only thing left to do here.
    if (collapsed && event.key !== 'Enter') return
    if (event.key === back) {
      event.preventDefault()
      setPx(currentPx - step)
    } else if (event.key === forward) {
      event.preventDefault()
      setPx(currentPx + step)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setPx(min)
    } else if (event.key === 'End') {
      event.preventDefault()
      setPx(upperBound)
    } else if (event.key === 'Enter' && collapsible) {
      event.preventDefault()
      onCollapsedChange?.(!collapsed)
    }
  }

  const [first, second] = children

  return (
    <div
      ref={containerRef}
      className={cn('flex min-h-0 min-w-0', horizontal ? 'flex-row' : 'flex-col', className)}
    >
      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-col overflow-hidden',
          secondCollapsed ? 'flex-1' : 'shrink-0'
        )}
        style={
          secondCollapsed
            ? undefined
            : firstPx == null
              ? { flex: `0 0 ${ratio * 100}%` }
              : horizontal
                ? { width: firstPx }
                : { height: firstPx }
        }
      >
        {first}
      </div>
      <div
        role="separator"
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={Number.isFinite(upperBound) ? Math.round(upperBound) : undefined}
        aria-valuenow={Math.round(currentPx)}
        tabIndex={0}
        onMouseDown={() => {
          if (collapsed) return
          dragging.current = true
          document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize'
          document.body.style.userSelect = 'none'
        }}
        onDoubleClick={() => setRatio(defaultRatio)}
        onKeyDown={onKeyDown}
        className={cn(
          'group relative shrink-0 bg-border transition-colors hover:bg-accent focus-visible:bg-accent',
          horizontal ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'
        )}
      >
        {/* 8px hit area over a 1px visual line */}
        <span
          aria-hidden
          className={cn(
            'absolute',
            horizontal ? '-left-1 -right-1 inset-y-0' : '-top-1 -bottom-1 inset-x-0'
          )}
        />
      </div>
      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-col overflow-hidden',
          secondCollapsed ? 'shrink-0' : 'flex-1'
        )}
        style={
          secondCollapsed
            ? horizontal
              ? { width: collapsedSize }
              : { height: collapsedSize }
            : undefined
        }
      >
        {second}
      </div>
    </div>
  )
}
