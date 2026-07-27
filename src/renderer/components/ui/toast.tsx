import * as React from 'react'
import { createPortal } from 'react-dom'
import { CircleCheck, CircleX, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import {
  pauseToastTimers,
  resumeToastTimers,
  useToastStore,
  type ToastRecord,
  type ToastTone
} from '@renderer/store/toast-store'
import { Button } from './button'
import { IconButton } from './icon-button'

const TONE_ICON: Record<ToastTone, LucideIcon> = {
  neutral: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX
}

const TONE_INK: Record<ToastTone, string> = {
  neutral: 'text-fg-muted',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger'
}

const MAX_VISIBLE = 3

export interface ToasterProps {
  dismissLabel?: string
  moreLabel?: (count: number) => React.ReactNode
  detailsLabel?: string
}

/**
 * Bottom-right stack, max 3 visible plus an "n more" collapser. Timers pause on
 * hover and focus-within; `danger` never auto-dismisses.
 */
export function Toaster({
  dismissLabel = 'Dismiss',
  moreLabel = (count) => `+${count} more`,
  detailsLabel = 'Details'
}: ToasterProps) {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)

  if (typeof document === 'undefined') return null
  if (toasts.length === 0) return null

  const visible = toasts.slice(-MAX_VISIBLE)
  const hidden = toasts.length - visible.length

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-[calc(var(--ds-chrome-statusbar)+0.75rem)] right-3 z-[var(--ds-z-toast)] flex w-[min(26rem,calc(100vw-1.5rem))] flex-col gap-2"
      onMouseEnter={pauseToastTimers}
      onMouseLeave={resumeToastTimers}
      onFocusCapture={pauseToastTimers}
      onBlurCapture={resumeToastTimers}
    >
      {hidden > 0 ? (
        <div className="pointer-events-auto self-end rounded-sm border border-border bg-raised px-1.5 py-0.5 text-2xs text-fg-muted shadow-raised">
          {moreLabel(hidden)}
        </div>
      ) : null}
      {visible.map((record) => (
        <ToastCard
          key={record.id}
          record={record}
          dismissLabel={dismissLabel}
          detailsLabel={detailsLabel}
          onDismiss={() => dismiss(record.id)}
        />
      ))}
    </div>,
    document.body
  )
}

function ToastCard({
  record,
  dismissLabel,
  detailsLabel,
  onDismiss
}: {
  record: ToastRecord
  dismissLabel: string
  detailsLabel: string
  onDismiss: () => void
}) {
  const Icon = TONE_ICON[record.tone]
  return (
    <div
      role={record.tone === 'danger' ? 'alert' : 'status'}
      aria-live={record.tone === 'danger' ? 'assertive' : 'polite'}
      className={cn(
        'pointer-events-auto flex items-start gap-2 rounded-lg border border-border-strong',
        'bg-raised px-3 py-2 shadow-overlay'
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className={cn('mt-0.5 size-3.5 shrink-0', TONE_INK[record.tone])}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm break-words text-fg">{record.title}</div>
        {record.description ? (
          <div className="mt-0.5 text-xs break-words text-fg-muted">{record.description}</div>
        ) : null}
        {record.details ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-fg-muted">{detailsLabel}</summary>
            <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-border bg-inset p-2 text-2xs break-words whitespace-pre-wrap text-fg-muted">
              {record.details}
            </pre>
          </details>
        ) : null}
        {record.action ? (
          <div className="mt-1.5">
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                record.action?.onClick()
                onDismiss()
              }}
            >
              {record.action.label}
            </Button>
          </div>
        ) : null}
      </div>
      <IconButton
        icon={X}
        label={dismissLabel}
        size="xs"
        variant="ghost"
        tooltip={false}
        onClick={onDismiss}
      />
    </div>
  )
}
