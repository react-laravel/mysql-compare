import * as React from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  )
}

/**
 * Every currently-trapping region, innermost last. A `ConfirmDialog` opened
 * from inside another `Dialog` mounts a second trap, and both listen on
 * `document` in the capture phase — without this stack the *outer* handler runs
 * first and Shift+Tab from the inner dialog jumps focus behind it.
 */
const trapStack: HTMLElement[] = []

/**
 * Traps Tab/Shift+Tab inside `ref` while `active`, moves focus into the region
 * on activation and restores it to the previously focused element on teardown.
 * Only the innermost active trap responds.
 */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  initialFocus?: React.RefObject<HTMLElement | null>
): void {
  React.useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    trapStack.push(node)

    const initial = initialFocus?.current ?? focusable(node)[0] ?? node
    if (!node.hasAttribute('tabindex') && initial === node) node.setAttribute('tabindex', '-1')
    initial.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      if (trapStack[trapStack.length - 1] !== node) return
      const items = focusable(node)
      if (items.length === 0) {
        event.preventDefault()
        node.focus({ preventScroll: true })
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      const current = document.activeElement
      if (event.shiftKey && (current === first || !node.contains(current))) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && current === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      const index = trapStack.lastIndexOf(node)
      if (index >= 0) trapStack.splice(index, 1)
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [ref, active, initialFocus])
}
