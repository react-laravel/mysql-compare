import * as React from 'react'

export interface RovingOptions {
  /** number of items in the group */
  count: number
  orientation?: 'horizontal' | 'vertical' | 'both'
  loop?: boolean
  /** index that should be the single tab stop; defaults to the active index */
  activeIndex?: number
  onActivate?: (index: number) => void
}

export interface RovingState {
  /** index that currently owns the group's single tab stop */
  index: number
  setIndex: (index: number) => void
  /** `tabIndex` for item `i` — one tab stop per group */
  tabIndexFor: (i: number) => 0 | -1
  register: (i: number) => (el: HTMLElement | null) => void
  onKeyDown: (event: React.KeyboardEvent) => void
  focus: (index: number) => void
}

/**
 * One tab stop per group, arrows move within it. Shared by `Tabs`, `TabStrip`,
 * `DropdownMenu`, `ToggleGroup` and `TreeRow` groups.
 */
export function useRovingTabIndex({
  count,
  orientation = 'horizontal',
  loop = true,
  activeIndex,
  onActivate
}: RovingOptions): RovingState {
  const [index, setIndex] = React.useState(activeIndex ?? 0)
  const items = React.useRef<(HTMLElement | null)[]>([])

  React.useEffect(() => {
    if (activeIndex != null) setIndex(activeIndex)
  }, [activeIndex])

  const current = Math.min(Math.max(index, 0), Math.max(count - 1, 0))

  const focus = React.useCallback(
    (next: number) => {
      setIndex(next)
      items.current[next]?.focus()
    },
    []
  )

  const move = React.useCallback(
    (delta: number) => {
      if (count === 0) return
      const raw = current + delta
      const next = loop ? (raw + count) % count : Math.min(Math.max(raw, 0), count - 1)
      focus(next)
    },
    [count, current, focus, loop]
  )

  const register = React.useCallback(
    (i: number) => (el: HTMLElement | null) => {
      items.current[i] = el
    },
    []
  )

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      const horizontal = orientation === 'horizontal' || orientation === 'both'
      const vertical = orientation === 'vertical' || orientation === 'both'
      if (horizontal && event.key === 'ArrowRight') {
        event.preventDefault()
        move(1)
      } else if (horizontal && event.key === 'ArrowLeft') {
        event.preventDefault()
        move(-1)
      } else if (vertical && event.key === 'ArrowDown') {
        event.preventDefault()
        move(1)
      } else if (vertical && event.key === 'ArrowUp') {
        event.preventDefault()
        move(-1)
      } else if (event.key === 'Home') {
        event.preventDefault()
        focus(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        focus(Math.max(count - 1, 0))
      } else if (event.key === 'Enter' || event.key === ' ') {
        if (!onActivate) return
        event.preventDefault()
        onActivate(current)
      }
    },
    [count, current, focus, move, onActivate, orientation]
  )

  return {
    index: current,
    setIndex,
    tabIndexFor: (i) => (i === current ? 0 : -1),
    register,
    onKeyDown,
    focus
  }
}
