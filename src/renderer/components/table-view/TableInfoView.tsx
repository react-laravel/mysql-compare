import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Copy, Pencil, Trash2 } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import type { TableSchema } from '../../../shared/types'

interface Props {
  connectionId: string
  database: string
  table: string
  readOnly?: boolean
}

export function TableInfoView({ connectionId, database, table, readOnly = false }: Props) {
  const { closeTableTabs, markTableDropped, showToast } = useUIStore()
  const { t } = useI18n()
  const [schema, setSchema] = useState<TableSchema | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [confirmSQL, setConfirmSQL] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const requestIdRef = useRef(0)

  const loadSchema = async () => {
    const requestId = ++requestIdRef.current
    const next = await unwrap<TableSchema>(api.schema.getTable(connectionId, database, table))
    if (requestId !== requestIdRef.current) return
    setSchema(next)
    setCommentDraft(next.tableComment ?? '')
  }

  useEffect(() => {
    setSchema(null)
    setEditing(false)
    setConfirmSQL(null)
    loadSchema().catch((error) => showToast((error as Error).message, 'error'))
  }, [connectionId, database, table, showToast])

  const pendingSQL = useMemo(() => {
    if (!schema) return ''
    return `ALTER TABLE ${quoteTable(database, table)} COMMENT = ${quoteString(commentDraft)};`
  }, [commentDraft, database, schema, table])

  const saveComment = async () => {
    if (!confirmSQL) return
    setBusy(true)
    try {
      await unwrap(api.db.executeSQL(connectionId, confirmSQL, database))
      showToast(t('tableInfo.commentUpdated'), 'success')
      setConfirmSQL(null)
      setEditing(false)
      await loadSchema()
    } catch (error) {
      showToast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const commentChanged = schema ? commentDraft !== (schema.tableComment ?? '') : false
  const actionBusy = busy || deleting

  const dropCurrentTable = async () => {
    if (actionBusy) return
    if (!confirm(t('sidebar.confirm.dropTable', { table }))) return

    setDeleting(true)
    try {
      await unwrap(
        api.db.dropTable({
          connectionId,
          database,
          table
        })
      )
      markTableDropped(connectionId, database, table)
      showToast(t('sidebar.toast.droppedTable', { table }), 'success')
      closeTableTabs(connectionId, database, table)
    } catch (error) {
      setDeleting(false)
      showToast((error as Error).message, 'error')
    }
  }

  if (!schema) {
    return <div className="p-3 text-xs text-muted-foreground">{t('common.loading')}</div>
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <InfoCard label={t('tableInfo.rows')} value={formatNumber(schema.rowEstimate)} />
        <InfoCard label={t('tableInfo.dataSize')} value={formatBytes(schema.dataLength)} />
        <InfoCard label={t('tableInfo.indexSize')} value={formatBytes(schema.indexLength)} />
        <InfoCard label={t('tableInfo.totalSize')} value={formatBytes((schema.dataLength ?? 0) + (schema.indexLength ?? 0))} />
        <InfoCard label={t('tableInfo.freeSpace')} value={formatBytes(schema.dataFree)} />
        <InfoCard label={t('tableInfo.avgRowLength')} value={formatBytes(schema.avgRowLength)} />
        <InfoCard label={t('tableInfo.engine')} value={schema.engine || '-'} />
        <InfoCard label={t('tableInfo.collation')} value={schema.charset || '-'} />
        <InfoCard label={t('tableInfo.autoIncrement')} value={schema.autoIncrement == null ? '-' : formatNumber(schema.autoIncrement)} />
        <InfoCard label={t('tableInfo.created')} value={schema.createdAt || '-'} />
        <InfoCard label={t('tableInfo.updated')} value={schema.updatedAt || '-'} />
        <InfoCard label={t('tableInfo.columnsIndexes')} value={`${schema.columns.length} / ${schema.indexes.length}`} />
      </div>

      {!readOnly && (
        <section className="mt-4 rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">{t('tableInfo.tableComment')}</h3>
            <div className="text-xs text-muted-foreground">{t('tableInfo.visibleHint')}</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={actionBusy}>
            <Pencil className="h-3.5 w-3.5" /> {t('tableInfo.editComment')}
          </Button>
        </div>
        <div className="rounded border border-border/70 bg-background p-3 text-sm whitespace-pre-wrap break-words">
          {schema.tableComment || <span className="text-muted-foreground">{t('tableInfo.noComment')}</span>}
        </div>
        </section>
      )}

      {readOnly && schema.createSQL && (
        <section className="mt-4 rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">{t('common.summary')}</h3>
          <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs">
            {schema.createSQL}
          </pre>
        </section>
      )}

      {!readOnly && (
        <section className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive dark:text-red-300">
                <AlertTriangle className="h-4 w-4" />
                {t('tableInfo.dangerZone')}
              </div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {t('tableInfo.dropTableDescription', { database, table })}
              </div>
            </div>
            <Button variant="destructive" onClick={dropCurrentTable} disabled={actionBusy}>
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? t('tableInfo.droppingTable') : t('tableInfo.dropTable')}
            </Button>
          </div>
        </section>
      )}

      {!readOnly && editing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !actionBusy) setEditing(false)
          }}
          title={t('tableInfo.editTableComment')}
          description={`${database}.${table}`}
          className="max-w-2xl"
          footer={
            <>
              <Button variant="outline" onClick={() => setEditing(false)} disabled={actionBusy}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => setConfirmSQL(pendingSQL)} disabled={actionBusy || !commentChanged}>
                {t('common.reviewSql')}
              </Button>
            </>
          }
        >
          <div>
            <Label className="mb-1 block">{t('common.comment')}</Label>
            <Input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} />
          </div>
        </Dialog>
      )}

      {!readOnly && confirmSQL && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !actionBusy) setConfirmSQL(null)
          }}
          title={t('tableInfo.confirmTableCommentChange')}
          description={t('tableInfo.reviewBeforeExecute')}
          className="max-w-3xl"
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirmSQL(null)} disabled={actionBusy}>
                {t('common.back')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(confirmSQL)
                  showToast(t('common.sqlCopied'), 'success')
                }}
                disabled={actionBusy}
              >
                <Copy className="h-3.5 w-3.5" /> {t('common.copySql')}
              </Button>
              <Button onClick={saveComment} disabled={actionBusy}>
                {busy ? t('tableInfo.executing') : t('common.confirmExecute')}
              </Button>
            </>
          }
        >
          <pre className="max-h-[60vh] overflow-auto rounded border border-border bg-card p-3 text-xs whitespace-pre-wrap break-all">
            {confirmSQL}
          </pre>
        </Dialog>
      )}
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium">{value}</div>
    </div>
  )
}

function formatBytes(value?: number): string {
  const bytes = Math.max(0, value ?? 0)
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}

function formatNumber(value?: number | null): string {
  if (value == null) return '-'
  return value.toLocaleString()
}

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

function quoteTable(database: string, table: string): string {
  return `${quoteIdent(database)}.${quoteIdent(table)}`
}

function quoteString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}
