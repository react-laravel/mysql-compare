// 表信息视图：统计、备注、CREATE TABLE 与危险区。
//
// Blueprint §3.3: `StatTile` grid + `Panel`s, and "Drop table…" opens the
// *same* `ConfirmDialog` the tree context menu opens. Before this, dropping a
// table was a themed dialog from the tree and a native `confirm()` here
// (§0.4) — the same operation with two different interaction models.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Copy, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { useSidebarActions } from '@renderer/components/layout/sidebar-actions'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { Field } from '@renderer/components/ui/field'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Input } from '@renderer/components/ui/input'
import { Panel } from '@renderer/components/ui/panel'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { StatTile } from '@renderer/components/ui/stat-tile'
import { Toolbar } from '@renderer/components/ui/toolbar'
import { formatBytes, formatNumber } from '@renderer/lib/format'
import { useAppAction } from '@renderer/lib/app-actions'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import type { TableSchema } from '../../../shared/types'

interface Props {
  connectionId: string
  database: string
  table: string
  readOnly?: boolean
  /** the Data / Structure / Info pill `Tabs` owned by the workspace */
  tabs?: ReactNode
  active?: boolean
}

export function TableInfoView({
  connectionId,
  database,
  table,
  readOnly = false,
  tabs,
  active = true
}: Props) {
  const { showToast } = useUIStore()
  const { t } = useI18n()
  const actions = useSidebarActions()
  const connection = useConnectionStore((state) =>
    state.connections.find((item) => item.id === connectionId)
  )
  const [schema, setSchema] = useState<TableSchema | null>(null)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [confirmSQL, setConfirmSQL] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const requestIdRef = useRef(0)

  const loadSchema = async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const next = await unwrap<TableSchema>(api.schema.getTable(connectionId, database, table))
      if (requestId !== requestIdRef.current) return
      setSchema(next)
      setLoadError(null)
      setCommentDraft(next.tableComment ?? '')
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }

  const reload = () => {
    loadSchema().catch((caught) => {
      setLoadError(caught instanceof Error ? caught : new Error(String(caught)))
      showToast((caught as Error).message, 'error')
    })
  }

  useEffect(() => {
    setSchema(null)
    setEditing(false)
    setConfirmSQL(null)
    loadSchema().catch((caught) => {
      setLoadError(caught instanceof Error ? caught : new Error(String(caught)))
      showToast((caught as Error).message, 'error')
    })
  }, [connectionId, database, table, showToast])

  useAppAction('refresh-view', active ? reload : null)

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

  const copyConfirmSQL = () => {
    if (!confirmSQL) return
    void navigator.clipboard.writeText(confirmSQL)
    showToast(t('common.sqlCopied'), 'success')
  }

  const copyCreateSQL = () => {
    if (!schema?.createSQL) return
    void navigator.clipboard.writeText(schema.createSQL)
    showToast(t('common.sqlCopied'), 'success')
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <Toolbar
        title={<span className="font-mono">{table}</span>}
        subtitle={[connection?.name, database].filter(Boolean).join(' / ')}
        center={tabs}
        progress={loading ? { status: 'running', label: t('common.loading') } : null}
        overflowLabel={t('common.moreActions')}
        overflow={[
          {
            id: 'copy-create',
            icon: Copy,
            label: t('common.copySql'),
            disabled: !schema?.createSQL,
            disabledReason: t('common.loading'),
            onSelect: copyCreateSQL
          },
          ...(readOnly || !connection
            ? []
            : [
                {
                  id: 'drop-table',
                  icon: Trash2,
                  label: t('sidebar.overlays.dropTable'),
                  danger: true,
                  onSelect: () => actions.requestDropTable(connection, database, table)
                } as const
              ])
        ]}
        actions={
          <IconButton
            icon={RefreshCw}
            label={t('common.refresh')}
            shortcut="Mod+R"
            size="sm"
            variant="ghost"
            loading={loading}
            disabled={loading}
            onClick={reload}
          />
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loadError && !schema ? (
          <EmptyState
            variant="error"
            title={t('tableStructure.loadFailed')}
            description={loadError.message}
            error={loadError}
            detailsLabel={t('common.details')}
            action={
              <Button variant="primary" icon={RefreshCw} onClick={reload}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : !schema ? (
          <Skeleton variant="tile" count={6} />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <StatTile label={t('tableInfo.rows')} value={formatNumber(schema.rowEstimate)} />
              <StatTile label={t('tableInfo.dataSize')} value={formatBytes(schema.dataLength)} />
              <StatTile label={t('tableInfo.indexSize')} value={formatBytes(schema.indexLength)} />
              <StatTile
                label={t('tableInfo.totalSize')}
                value={formatBytes((schema.dataLength ?? 0) + (schema.indexLength ?? 0))}
              />
              <StatTile label={t('tableInfo.freeSpace')} value={formatBytes(schema.dataFree)} />
              <StatTile label={t('tableInfo.avgRowLength')} value={formatBytes(schema.avgRowLength)} />
              <StatTile label={t('tableInfo.engine')} value={schema.engine || '-'} />
              <StatTile label={t('tableInfo.collation')} value={schema.charset || '-'} />
              <StatTile
                label={t('tableInfo.autoIncrement')}
                value={schema.autoIncrement == null ? '-' : formatNumber(schema.autoIncrement)}
              />
              <StatTile label={t('tableInfo.created')} value={schema.createdAt || '-'} />
              <StatTile label={t('tableInfo.updated')} value={schema.updatedAt || '-'} />
              <StatTile
                label={t('tableInfo.columnsIndexes')}
                value={`${schema.columns.length} / ${schema.indexes.length}`}
              />
            </div>

            {!readOnly && (
              <Panel
                className="mt-3"
                header={t('tableInfo.tableComment')}
                description={t('tableInfo.visibleHint')}
                headerActions={
                  <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(true)} disabled={busy}>
                    {t('tableInfo.editComment')}
                  </Button>
                }
              >
                <div className="rounded-md border border-border bg-inset p-3 text-sm break-words whitespace-pre-wrap">
                  {schema.tableComment || <span className="text-fg-muted">{t('tableInfo.noComment')}</span>}
                </div>
              </Panel>
            )}

            {schema.createSQL && (
              <Panel
                className="mt-3"
                header={t('tableInfo.createStatement')}
                headerActions={
                  <Button size="sm" variant="secondary" icon={Copy} onClick={copyCreateSQL}>
                    {t('common.copy')}
                  </Button>
                }
              >
                <pre className="max-h-[40vh] overflow-auto rounded-md border border-border bg-inset p-3 font-mono text-xs break-words whitespace-pre-wrap">
                  {schema.createSQL}
                </pre>
              </Panel>
            )}

            {!readOnly && (
              <Panel
                className="mt-3"
                tone="danger"
                header={t('tableInfo.dangerZone')}
                description={t('tableInfo.dropTableDescription', { database, table })}
                headerActions={
                  <Button
                    variant="danger"
                    icon={Trash2}
                    disabled={!connection}
                    // The tree's `⋯`, the right-click menu and this button all
                    // request the same `sidebar-store.pendingConfirm`.
                    onClick={() => {
                      if (connection) actions.requestDropTable(connection, database, table)
                    }}
                  >
                    {t('tableInfo.dropTable')}
                  </Button>
                }
              />
            )}
          </>
        )}
      </div>

      {!readOnly && editing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setEditing(false)
          }}
          title={t('tableInfo.editTableComment')}
          description={`${database}.${table}`}
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(false)} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => setConfirmSQL(pendingSQL)}
                disabled={busy || !commentChanged}
              >
                {t('common.reviewSql')}
              </Button>
            </>
          }
        >
          <Field label={t('common.comment')}>
            <Input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} />
          </Field>
        </Dialog>
      )}

      {!readOnly && confirmSQL && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setConfirmSQL(null)
          }}
          title={t('tableInfo.confirmTableCommentChange')}
          description={t('tableInfo.reviewBeforeExecute')}
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmSQL(null)} disabled={busy}>
                {t('common.back')}
              </Button>
              <Button variant="secondary" icon={Copy} onClick={copyConfirmSQL} disabled={busy}>
                {t('common.copySql')}
              </Button>
              <Button variant="primary" onClick={saveComment} loading={busy} disabled={busy}>
                {busy ? t('tableInfo.executing') : t('common.confirmExecute')}
              </Button>
            </>
          }
        >
          <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-inset p-3 font-mono text-xs break-all whitespace-pre-wrap">
            {confirmSQL}
          </pre>
        </Dialog>
      )}
    </div>
  )
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
