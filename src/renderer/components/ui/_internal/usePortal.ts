import * as React from 'react'

/**
 * Portal target. Defaults to `document.body` — but a `Popover` opened inside a
 * `Dialog` receives the dialog element so it inherits the dialog's stacking
 * context instead of fighting the z ladder (DESIGN-SYSTEM §4).
 */
export function usePortal(container?: HTMLElement | null): HTMLElement | null {
  const [target, setTarget] = React.useState<HTMLElement | null>(null)

  React.useEffect(() => {
    if (container) {
      setTarget(container)
      return
    }
    if (typeof document === 'undefined') return
    setTarget(document.body)
  }, [container])

  return target
}

/**
 * The nearest ancestor that should own portalled overlays: a dialog element when
 * one is above us, otherwise `null` (meaning `document.body`).
 */
export function useOverlayContainer(from: React.RefObject<HTMLElement | null>): HTMLElement | null {
  const [container, setContainer] = React.useState<HTMLElement | null>(null)

  React.useEffect(() => {
    const node = from.current
    if (!node) return
    setContainer(node.closest<HTMLElement>('[role="dialog"]'))
  }, [from])

  return container
}
