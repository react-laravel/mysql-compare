import * as React from 'react'
import { DropdownMenu, type MenuItem } from './dropdown-menu'

export interface ContextMenuState {
  x: number
  y: number
}

export interface ContextMenuProps {
  items: MenuItem[]
  /** pointer position from the `contextmenu` event; `null` closes the menu */
  at: ContextMenuState | null
  onClose: () => void
  container?: HTMLElement | null
  width?: string
  'aria-label'?: string
}

/**
 * `DropdownMenu` opened at the pointer. The clamping lives in `useFloating`, so
 * the menu size is measured instead of hardcoded (the four implementations this
 * replaces used 216/184 and 296/104 as magic numbers).
 */
export function ContextMenu({ items, at, onClose, container, width, ...rest }: ContextMenuProps) {
  if (!at) return null
  return (
    <DropdownMenu
      {...rest}
      items={items}
      width={width}
      container={container}
      anchorPoint={at}
      side="bottom"
      align="start"
      offset={0}
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    />
  )
}

/** Convenience state hook for the `onContextMenu` → menu-position pattern. */
export function useContextMenu<T>(): {
  state: (ContextMenuState & { payload: T }) | null
  open: (event: React.MouseEvent, payload: T) => void
  close: () => void
} {
  const [state, setState] = React.useState<(ContextMenuState & { payload: T }) | null>(null)
  return {
    state,
    open: (event, payload) => {
      event.preventDefault()
      setState({ x: event.clientX, y: event.clientY, payload })
    },
    close: () => setState(null)
  }
}
