import * as React from 'react'
import { X, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ContextMenu, useContextMenu } from './context-menu'
import type { MenuItem } from './dropdown-menu'
import { StatusDot } from './status-dot'

export interface DocumentTab {
  id: string
  title: string
  icon?: LucideIcon
  dirty?: boolean
  /** replaces the icon with a StatusDot while a job owns the tab */
  status?: 'running' | 'error' | null
  closable?: boolean
}

export interface TabStripProps {
  tabs: DocumentTab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose?: (id: string) => void
  onReorder?: (fromId: string, toId: string) => void
  onContextMenu?: (id: string) => MenuItem[]
  leading?: React.ReactNode
  trailing?: React.ReactNode
  closeLabel?: string
  className?: string
  'aria-label': string
}

/**
 * Closable, reorderable document tabs with dirty dots and a context menu. It
 * always exposes the same affordances regardless of who mounts it.
 */
export function TabStrip({
  tabs,
  activeId,
  onSelect,
  onClose,
  onReorder,
  onContextMenu,
  leading,
  trailing,
  closeLabel = 'Close tab',
  className,
  'aria-label': ariaLabel
}: TabStripProps) {
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [dragOverId, setDragOverId] = React.useState<string | null>(null)
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({})
  const menu = useContextMenu<string>()

  // Selecting a tab from the palette or ⌘1…9 must bring it into view.
  React.useEffect(() => {
    if (!activeId) return
    refs.current[activeId]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  const focusTab = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length]
    if (!tab) return
    onSelect(tab.id)
    refs.current[tab.id]?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusTab(index + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusTab(index - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusTab(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusTab(tabs.length - 1)
    }
  }

  const menuItems = menu.state && onContextMenu ? onContextMenu(menu.state.payload) : []

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'flex h-tabstrip shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-1.5',
        className
      )}
    >
      {leading}
      {tabs.map((tab, index) => {
        const active = tab.id === activeId
        const closable = tab.closable !== false && onClose != null
        const Icon = tab.icon
        return (
          <div
            key={tab.id}
            draggable={onReorder != null}
            onMouseDown={(event) => {
              if (event.button !== 1 || !closable) return
              event.preventDefault()
              onClose?.(tab.id)
            }}
            onContextMenu={(event) => {
              if (!onContextMenu) return
              menu.open(event, tab.id)
            }}
            onDragStart={(event) => {
              if (!onReorder) return
              setDragId(tab.id)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', tab.id)
            }}
            onDragEnter={() => {
              if (dragId && dragId !== tab.id) setDragOverId(tab.id)
            }}
            onDragOver={(event) => {
              if (!dragId || dragId === tab.id) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setDragOverId(tab.id)
            }}
            onDrop={(event) => {
              event.preventDefault()
              const sourceId = dragId ?? event.dataTransfer.getData('text/plain')
              if (sourceId && sourceId !== tab.id) onReorder?.(sourceId, tab.id)
              setDragId(null)
              setDragOverId(null)
            }}
            onDragEnd={() => {
              setDragId(null)
              setDragOverId(null)
            }}
            className={cn(
              'group flex h-[26px] min-w-0 shrink-0 items-center gap-1 rounded-md border px-1.5 text-sm transition-colors',
              active
                ? 'border-accent/35 bg-selected text-fg'
                : 'border-transparent text-fg-muted hover:bg-hover hover:text-fg',
              dragId === tab.id && 'opacity-60',
              dragOverId === tab.id && 'ring-1 ring-ring'
            )}
          >
            <button
              ref={(element) => {
                refs.current[tab.id] = element
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={tab.title}
              data-focus-inset
              onKeyDown={(event) => onKeyDown(event, index)}
              onClick={() => onSelect(tab.id)}
              className="flex min-w-0 items-center gap-1.5"
            >
              {tab.status ? (
                <StatusDot status={tab.status === 'error' ? 'danger' : 'running'} />
              ) : Icon ? (
                <Icon aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0" />
              ) : null}
              <span className="max-w-48 truncate">{tab.title}</span>
              {tab.dirty ? (
                <span
                  aria-hidden
                  title="Unsaved changes"
                  className="size-1.5 shrink-0 rounded-full bg-accent"
                />
              ) : null}
            </button>
            {closable ? (
              <button
                type="button"
                aria-label={closeLabel}
                title={closeLabel}
                data-focus-inset
                onClick={(event) => {
                  event.stopPropagation()
                  onClose?.(tab.id)
                }}
                className={cn(
                  'flex size-control-xs items-center justify-center rounded-sm transition-opacity hover:bg-hover',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                )}
              >
                <X aria-hidden strokeWidth={1.75} className="size-3" />
              </button>
            ) : null}
          </div>
        )
      })}
      {trailing}
      {onContextMenu ? (
        <ContextMenu
          items={menuItems}
          at={menu.state}
          onClose={menu.close}
          width="w-52"
          aria-label={ariaLabel}
        />
      ) : null}
    </div>
  )
}
