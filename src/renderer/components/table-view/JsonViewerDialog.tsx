import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { useI18n } from '@renderer/i18n'
import { ClipboardCopy } from 'lucide-react'
import type { ColumnInfo } from '../../../shared/types'
import { isJsonContentEqual } from './row-edit-dialog-utils'

export interface JsonViewerState {
  column: ColumnInfo
  row: Record<string, unknown>
  content: string
}

interface Props {
  state: JsonViewerState
  readOnly?: boolean
  onClose: () => void
  onSave?: (row: Record<string, unknown>, column: string, value: string) => Promise<void>
}

export function JsonViewerDialog({ state, readOnly = false, onClose, onSave }: Props) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(state.content)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(state.content)
    setBusy(false)
    setError(null)
  }, [state])

  const canEdit = !readOnly && Boolean(onSave)
  const hasChanges = useMemo(
    () => !isJsonContentEqual(state.row[state.column.name], draft),
    [draft, state.column.name, state.row]
  )

  const copyContent = async () => {
    await navigator.clipboard.writeText(draft)
  }

  const handleSave = async () => {
    if (!onSave) return

    const trimmed = draft.trim()
    try {
      JSON.parse(trimmed)
    } catch {
      setError(t('tableData.validJsonRequired'))
      return
    }

    setError(null)
    setBusy(true)
    try {
      await onSave(state.row, state.column.name, trimmed)
      onClose()
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('tableData.jsonViewerTitle')}
      description={state.column.name}
      className="max-w-4xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.close')}
          </Button>
          <Button variant="outline" onClick={copyContent} disabled={busy}>
            <ClipboardCopy className="h-4 w-4" /> {t('tableData.copyJson')}
          </Button>
          {canEdit && (
            <Button onClick={handleSave} disabled={busy || !hasChanges}>
              {t('common.update')}
            </Button>
          )}
        </>
      }
    >
      {canEdit ? (
        <textarea
          value={draft}
          onChange={(event) => {
            setError(null)
            setDraft(event.target.value)
          }}
          rows={18}
          spellCheck={false}
          className="max-h-[70vh] w-full resize-y rounded-md border border-input bg-background p-3 font-mono text-xs"
        />
      ) : (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs">
          {draft}
        </pre>
      )}
      {error && (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </Dialog>
  )
}
