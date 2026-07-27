import * as React from 'react'

interface DismissOptions {
  onDismiss: () => void
  /** dismiss on pointerdown outside `ref` — default true */
  outside?: boolean
  /** dismiss on Escape — default true */
  escape?: boolean
  enabled?: boolean
  /**
   * Extra elements that count as "inside". A popover trigger belongs here:
   * otherwise pointerdown dismisses and the trigger's own click re-opens.
   */
  ignore?: React.RefObject<HTMLElement | null>[]
}

interface DismissLayer {
  node: () => HTMLElement | null
  dismiss: () => void
}

/**
 * Every mounted Escape-dismissable surface, in mount order. `stopPropagation()`
 * cannot arbitrate between them — listeners on the same node all run regardless
 * — so the ladder is resolved explicitly here instead.
 */
const escapeLayers: DismissLayer[] = []
/** One Escape press dismisses one layer, even across re-entrant listeners. */
const handledEscapes = new WeakSet<KeyboardEvent>()

/**
 * The layer Escape belongs to: a surface that *contains* another surface sits
 * below it (a `Popover` portalled into a `Dialog`), and among surfaces that do
 * not nest, the most recently mounted one is on top.
 */
function topEscapeLayer(): DismissLayer | null {
  if (escapeLayers.length === 0) return null
  const entries = escapeLayers.map((layer) => ({ layer, node: layer.node() }))
  const unobstructed = entries.filter(
    (entry) =>
      !entries.some(
        (other) =>
          other.layer !== entry.layer &&
          entry.node != null &&
          other.node != null &&
          other.node !== entry.node &&
          entry.node.contains(other.node)
      )
  )
  const pool = unobstructed.length > 0 ? unobstructed : entries
  return pool[pool.length - 1]?.layer ?? null
}

/**
 * One outside-click / Escape implementation shared by every overlay primitive.
 * Escape closes the **topmost layer only** — never the dialog underneath the
 * menu that was actually open.
 */
export function useDismiss(
  ref: React.RefObject<HTMLElement | null>,
  { onDismiss, outside = true, escape = true, enabled = true, ignore }: DismissOptions
): void {
  const handler = React.useRef(onDismiss)
  handler.current = onDismiss
  const ignored = React.useRef(ignore)
  ignored.current = ignore

  React.useEffect(() => {
    if (!enabled) return

    const layer: DismissLayer = {
      node: () => ref.current,
      dismiss: () => handler.current()
    }
    if (escape) escapeLayers.push(layer)

    const onKeyDown = (event: KeyboardEvent) => {
      if (!escape) return
      if (event.key !== 'Escape') return
      if (handledEscapes.has(event)) return
      if (topEscapeLayer() !== layer) return
      handledEscapes.add(event)
      event.stopPropagation()
      layer.dismiss()
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!outside) return
      const node = ref.current
      if (!node) return
      const target = event.target as Node
      if (node.contains(target)) return
      if (ignored.current?.some((candidate) => candidate.current?.contains(target))) return
      handler.current()
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      const index = escapeLayers.indexOf(layer)
      if (index >= 0) escapeLayers.splice(index, 1)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [ref, outside, escape, enabled])
}
