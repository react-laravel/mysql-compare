import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { IconButton } from './icon-button'
import { useDismiss } from './_internal/useDismiss'
import { useFocusTrap } from './_internal/useFocusTrap'

export interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  side?: 'right' | 'bottom'
  size?: 'sm' | 'md'
  footer?: React.ReactNode
  initialFocus?: React.RefObject<HTMLElement | null>
  dismissible?: boolean
  closeLabel?: string
  className?: string
  children: React.ReactNode
}

const RIGHT_SIZE = { sm: 'w-80', md: 'w-[27.5rem]' } as const
const BOTTOM_SIZE = { sm: 'h-64', md: 'h-96' } as const

/** Side detail panel. Same overlay contract as `Dialog`. */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  side = 'right',
  size = 'sm',
  footer,
  initialFocus,
  dismissible = true,
  closeLabel = 'Close',
  className,
  children
}: DrawerProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const titleId = React.useId()
  const descId = React.useId()

  useFocusTrap(ref, open, initialFocus)
  useDismiss(ref, { enabled: open && dismissible, onDismiss: () => onOpenChange(false) })

  if (!open) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[var(--ds-z-dialog)]">
      <div className="absolute inset-0 bg-overlay" aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          'absolute flex flex-col border-border-strong bg-raised shadow-overlay',
          side === 'right'
            ? cn('inset-y-0 right-0 border-l', RIGHT_SIZE[size])
            : cn('inset-x-0 bottom-0 border-t', BOTTOM_SIZE[size]),
          className
        )}
      >
        <header className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-0.5 text-xs text-fg-muted">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <IconButton
              icon={X}
              label={closeLabel}
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            />
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer ? (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
