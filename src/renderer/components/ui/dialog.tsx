// 自实现的轻量 Modal，避免引 Radix。焦点陷阱 + 焦点恢复 + aria-modal。
import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from './button'
import { useFocusTrap } from './_internal/useFocusTrap'
import { useDismiss } from './_internal/useDismiss'

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE: Record<DialogSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl'
}

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** REQUIRED — wired to aria-labelledby */
  title: React.ReactNode
  description?: React.ReactNode
  size?: DialogSize
  children: React.ReactNode
  className?: string
  footer?: React.ReactNode
  initialFocus?: React.RefObject<HTMLElement | null>
  /** false while a job inside the dialog is running */
  dismissible?: boolean
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  children,
  className,
  footer,
  initialFocus,
  dismissible = true
}: DialogProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const titleId = React.useId()
  const descId = React.useId()

  useFocusTrap(ref, open, initialFocus)
  useDismiss(ref, {
    enabled: open && dismissible,
    onDismiss: () => onOpenChange(false)
  })

  if (!open) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[var(--ds-z-dialog)] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-overlay" aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          'relative flex max-h-[85vh] w-full flex-col rounded-xl border border-border-strong',
          'bg-raised shadow-overlay',
          SIZE[size],
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
            <Button
              variant="ghost"
              size="sm"
              className="aspect-square shrink-0 px-0"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
            >
              <X aria-hidden strokeWidth={1.75} />
            </Button>
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
