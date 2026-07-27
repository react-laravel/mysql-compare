import { useEffect, useRef, useState } from 'react'
import { FileText, UploadCloud } from 'lucide-react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Label } from '@renderer/components/ui/label'
import { Select } from '@renderer/components/ui/select'
import { cn } from '@renderer/lib/utils'
import { api, unwrap } from '@renderer/lib/api'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import type { ImportFormat, ImportTableRequest, ImportTableResult } from '../../../shared/types'

interface SelectedImportFile {
  name: string
  content: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  table: string
  onImported?: () => void | Promise<void>
}

export function ImportTableDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  table,
  onImported
}: Props) {
  const { showToast } = useUIStore()
  const { t } = useI18n()
  const [format, setFormat] = useState<ImportFormat>('csv')
  const [includeHeaders, setIncludeHeaders] = useState(true)
  const [emptyAsNull, setEmptyAsNull] = useState(true)
  const [selectedFile, setSelectedFile] = useState<SelectedImportFile | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const fileAccept = format === 'sql' ? '.sql' : format === 'csv' ? '.csv' : '.txt,.tsv'

  useEffect(() => {
    if (!open) return
    setFormat('csv')
    setIncludeHeaders(true)
    setEmptyAsNull(true)
    setSelectedFile(null)
    setDragActive(false)
  }, [connectionId, database, open, table])

  const clearSelectedFile = () => {
    setSelectedFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const updateFormat = (nextFormat: ImportFormat) => {
    setFormat(nextFormat)
    clearSelectedFile()
  }

  const readImportFile = async (file: File) => {
    try {
      setSelectedFile({ name: file.name, content: await file.text() })
    } catch {
      showToast(t('importDialog.fileReadFailed'), 'error')
    }
  }

  const onDropFile = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragActive(false)
    const file = event.dataTransfer.files.item(0)
    if (file) void readImportFile(file)
  }

  const submit = async () => {
    if (!selectedFile) {
      showToast(t('importDialog.fileRequired'), 'error')
      return
    }

    const request: ImportTableRequest = {
      connectionId,
      database,
      table,
      format,
      includeHeaders,
      emptyAsNull,
      fileName: selectedFile.name,
      fileContent: selectedFile.content
    }

    setBusy(true)
    try {
      const result = await unwrap<ImportTableResult>(api.db.importTable(request))
      if (!result.canceled) {
        const message =
          format === 'sql'
            ? t('importDialog.importedStatements', { count: result.statementsExecuted })
            : t('importDialog.importedRows', { count: result.rowsImported })
        showToast(message, 'success')
        await onImported?.()
        onOpenChange(false)
      }
    } catch (error) {
      showToast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('importDialog.title')}
      description={`${database}.${table}`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !selectedFile}>
            {busy ? t('importDialog.importing') : t('common.import')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label className="block mb-1">{t('importDialog.format')}</Label>
          <Select
            value={format}
            onChange={(event) => updateFormat(event.target.value as ImportFormat)}
            options={[
              { value: 'csv', label: t('importDialog.csv') },
              { value: 'txt', label: t('importDialog.text') },
              { value: 'sql', label: t('importDialog.sql') }
            ]}
          />
        </div>

        <div>
          <Label className="block mb-1">{t('importDialog.file')}</Label>
          <input
            ref={inputRef}
            type="file"
            accept={fileAccept}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.item(0)
              if (file) void readImportFile(file)
            }}
          />
          <div
            className={cn(
              'flex min-h-28 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-canvas p-4 text-center transition-colors',
              dragActive && 'border-accent bg-accent/10'
            )}
            onDragOver={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDropFile}
          >
            {selectedFile ? (
              <div className="flex max-w-full items-center gap-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-fg-muted" />
                <span className="truncate font-medium">{selectedFile.name}</span>
              </div>
            ) : (
              <>
                <UploadCloud className="h-6 w-6 text-fg-muted" />
                <div className="text-sm text-fg-muted">{t('importDialog.dropFileHint')}</div>
              </>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
              {t('importDialog.chooseFile')}
            </Button>
          </div>
        </div>

        {format === 'sql' ? (
          <div className="rounded-md border border-border bg-canvas p-3 text-xs text-fg-muted">
            {t('importDialog.sqlHint')}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={includeHeaders} onChange={(event) => setIncludeHeaders(event.target.checked)} />
              {t('importDialog.includeHeader')}
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={emptyAsNull} onChange={(event) => setEmptyAsNull(event.target.checked)} />
              {t('importDialog.emptyAsNull')}
            </label>
            <div className="text-xs text-fg-muted">
              {format === 'csv' ? t('importDialog.csvHint') : t('importDialog.textHint')}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
