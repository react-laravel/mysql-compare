import * as React from 'react'
import { cn } from '@renderer/lib/utils'

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'vertical' | 'both'
  /** persists scrollTop in sessionStorage under this key */
  restoreKey?: string
  onReachEnd?: () => void
  viewportRef?: React.Ref<HTMLDivElement>
  /** hairline shadow under a sticky header once scrolled */
  stickyShadow?: boolean
}

const STORAGE_PREFIX = 'mysql-compare:scroll:'

/**
 * Owns exactly one scroll region and exposes its viewport ref, so nothing has
 * to reach for the shell by class name to find its scroll parent.
 */
export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  {
    orientation = 'vertical',
    restoreKey,
    onReachEnd,
    viewportRef,
    stickyShadow,
    className,
    children,
    onScroll,
    ...rest
  },
  ref
) {
  const inner = React.useRef<HTMLDivElement | null>(null)
  const [scrolled, setScrolled] = React.useState(false)
  const reachEnd = React.useRef(onReachEnd)
  reachEnd.current = onReachEnd

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      inner.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
      if (typeof viewportRef === 'function') viewportRef(node)
      else if (viewportRef) (viewportRef as React.RefObject<HTMLDivElement | null>).current = node
    },
    [ref, viewportRef]
  )

  React.useEffect(() => {
    if (!restoreKey) return
    const node = inner.current
    if (!node) return
    const saved = sessionStorage.getItem(STORAGE_PREFIX + restoreKey)
    if (saved) node.scrollTop = Number(saved) || 0
    return () => {
      sessionStorage.setItem(STORAGE_PREFIX + restoreKey, String(node.scrollTop))
    }
  }, [restoreKey])

  return (
    <div
      ref={setRefs}
      className={cn(
        'min-h-0 min-w-0 flex-1',
        orientation === 'both' ? 'overflow-auto' : 'overflow-y-auto overflow-x-hidden',
        stickyShadow && scrolled && 'shadow-[inset_0_1px_0_0_var(--ds-border)]',
        className
      )}
      onScroll={(event) => {
        onScroll?.(event)
        const node = event.currentTarget
        if (stickyShadow) setScrolled(node.scrollTop > 0)
        if (reachEnd.current && node.scrollHeight - node.scrollTop - node.clientHeight < 32) {
          reachEnd.current()
        }
      }}
      {...rest}
    >
      {children}
    </div>
  )
})
