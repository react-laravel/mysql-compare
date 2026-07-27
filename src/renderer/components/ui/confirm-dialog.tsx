import * as React from 'react'
import { cn } from '@renderer/lib/utils'
import { Button } from './button'
import { Dialog } from './dialog'
import { Input } from './input'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  body?: React.ReactNode
  /** the object being acted on — rendered in mono inside a tinted box */
  subject?: React.ReactNode
  /** "This cannot be undone." */
  consequence?: React.ReactNode
  tone?: 'default' | 'danger'
  confirmLabel?: React.ReactNode
  cancelLabel?: React.ReactNode
  /** truncate genuinely needs two destructive options */
  secondaryConfirm?: { label: React.ReactNode; onConfirm: () => void | Promise<void> }
  /** the user must type this exact string to enable confirm (drop database) */
  requireTypedConfirmation?: string
  typedConfirmationHint?: React.ReactNode
  onConfirm: () => void | Promise<void>
}

/**
 * The one destructive-confirmation surface. Focus lands on **Cancel**, the
 * destructive action sits last, and the dialog is undismissible while the
 * action runs. Replaces every native `confirm()`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  subject,
  consequence,
  tone = 'danger',
  confirmLabel,
  cancelLabel,
  secondaryConfirm,
  requireTypedConfirmation,
  typedConfirmationHint,
  onConfirm
}: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false)
  const [typed, setTyped] = React.useState('')
  const cancelRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (open) {
      setBusy(false)
      setTyped('')
    }
  }, [open])

  const gated = requireTypedConfirmation != null && typed !== requireTypedConfirmation
  const danger = tone === 'danger'

  const run = async (action: () => void | Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return
        onOpenChange(next)
      }}
      title={title}
      size="sm"
      dismissible={!busy}
      initialFocus={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          {secondaryConfirm ? (
            <Button
              variant={danger ? 'danger' : 'secondary'}
              loading={busy}
              disabled={busy || gated}
              onClick={() => void run(secondaryConfirm.onConfirm)}
            >
              {secondaryConfirm.label}
            </Button>
          ) : null}
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            disabled={busy || gated}
            onClick={() => void run(onConfirm)}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {body ? <div className="text-sm text-fg">{body}</div> : null}
        {subject ? (
          <div
            className={cn(
              'rounded-md border p-3 font-mono text-sm break-all',
              danger ? 'border-danger/30 bg-danger-quiet text-danger-text' : 'border-border bg-inset text-fg'
            )}
          >
            {subject}
          </div>
        ) : null}
        {consequence ? <p className="text-xs text-fg-muted">{consequence}</p> : null}
        {requireTypedConfirmation != null ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-muted">{typedConfirmationHint}</span>
            <Input
              mono
              autoFocus={false}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={requireTypedConfirmation}
            />
          </label>
        ) : null}
      </div>
    </Dialog>
  )
}
