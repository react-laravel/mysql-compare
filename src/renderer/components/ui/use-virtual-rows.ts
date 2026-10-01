import { useCallback, useLayoutEffect, useMemo, useState, type RefObject } from 'react'

interface Options {
  viewportRef: RefObject<HTMLElement | null>
  count: number
  rowHeight: number | readonly number[]
  enabled?: boolean
  headerHeight?: number
  pinnedIndexes?: readonly number[]
}

/** A bounded DOM window; pinned focus rows remain mounted while scrolling. */
export function useVirtualRows({ viewportRef, count, rowHeight, enabled = true, headerHeight = 0, pinnedIndexes = [] }: Options) {
  const virtual = enabled && count > 100
  const [viewport, setViewport] = useState({ top: 0, height: 480 })
  const offsets = useMemo(() => {
    const result = [0]
    for (let index = 0; index < count; index++) {
      result.push(result[index]! + (typeof rowHeight === 'number' ? rowHeight : rowHeight[index] ?? 28))
    }
    return result
  }, [count, rowHeight])

  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const update = () => setViewport((current) => {
      const next = { top: element.scrollTop, height: element.clientHeight || 480 }
      return next.top === current.top && next.height === current.height ? current : next
    })
    update()
    element.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(element)
    return () => { element.removeEventListener('scroll', update); observer?.disconnect() }
  }, [viewportRef, virtual])

  const findIndex = useCallback((offset: number) => {
    let low = 0
    let high = count
    while (low < high) {
      const middle = (low + high) >>> 1
      if (offsets[middle + 1]! <= offset) low = middle + 1
      else high = middle
    }
    return Math.min(low, Math.max(count - 1, 0))
  }, [count, offsets])

  const start = virtual ? Math.max(0, findIndex(Math.max(0, viewport.top - headerHeight)) - 6) : 0
  const end = virtual ? Math.min(count, findIndex(viewport.top + viewport.height) + 7) : count
  const indexes = new Set(Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index))
  if (virtual) for (const index of pinnedIndexes) if (index >= 0 && index < count) indexes.add(index)

  const scrollToIndex = useCallback((index: number) => {
    const element = viewportRef.current
    if (!element) return
    const top = offsets[index] ?? 0
    const bottom = offsets[index + 1] ?? top
    const height = element.clientHeight || 480
    if (top < element.scrollTop) element.scrollTop = top
    else if (bottom + headerHeight > element.scrollTop + height) element.scrollTop = bottom + headerHeight - height
    setViewport({ top: element.scrollTop, height })
  }, [headerHeight, offsets, viewportRef])

  return { virtual, indexes: [...indexes].sort((a, b) => a - b), offsets, totalHeight: offsets[count] ?? 0, scrollToIndex }
}
