// 表结构视图：字段、索引、CREATE TABLE，并支持列/索引结构修改。
//
// Blueprint §3.2: one `Toolbar` (title · sub-tabs · actions · `⋯`) over a
// filters row, then two `DataTable variant="report"` inside `Panel`s and a
// `Panel` holding the CREATE statement. The per-row Edit/Delete buttons became
// a row `⋯`, and the two dashed empty boxes became `EmptyState`s with actions.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Copy, EllipsisVertical, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { DataTable, type Column } from '@renderer/components/ui/data-table'
import { DropdownMenu, type MenuItem } from '@renderer/components/ui/dropdown-menu'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Panel } from '@renderer/components/ui/panel'
import { SearchInput } from '@renderer/components/ui/search-input'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Toolbar } from '@renderer/components/ui/toolbar'
import { useAppAction } from '@renderer/lib/app-actions'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import type { ColumnInfo, DbEngine, IndexInfo, TableSchema } from '../../../shared/types'
import { TableStructureDialogs } from './TableStructureDialogs'
import { buildAlterColumnSQL, buildDropIndexSQL, buildIndexSQL } from './table-structure-sql'
import type { ColumnDraft, IndexDraft, PendingAction } from './table-structure-types'

interface Props {
  connectionId: string
  database: string
  table: string
  engine?: DbEngine
  /** the Data / Structure / Info pill `Tabs` owned by the workspace */
  tabs?: ReactNode
  active?: boolean
}

export function TableStructureView({
  connectionId,
  database,
  table,
  engine = 'mysql',
  tabs,
  active = true
}: Props) {
  const sqlEngine = engine === 'postgres' ? 'postgres' : 'mysql'
  const { showToast } = useUIStore()
  const { t } = useI18n()
  const connectionName = useConnectionStore(
    (state) => state.connections.find((item) => item.id === connectionId)?.name
  )
  const [schema, setSchema] = useState<TableSchema | null>(null)
  const [schemaError, setSchemaError] = useState<Error | null>(null)
  const [editingColumn, setEditingColumn] = useState<ColumnDraft | null>(null)
  const [editingIndex, setEditingIndex] = useState<IndexDraft | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [structureQuery, setStructureQuery] = useState('')
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const filterInputRef = useRef<HTMLInputElement | null>(null)

  const loadSchema = async () => {
    setSchemaLoading(true)
    try {
      const next = await unwrap<TableSchema>(api.schema.getTable(connectionId, database, table))
      setSchema(next)
      setSchemaError(null)
    } finally {
      setSchemaLoading(false)
    }
  }

  const reloadSchema = () => {
    loadSchema().catch((caught) => {
      setSchemaError(caught instanceof Error ? caught : new Error(String(caught)))
      showToast((caught as Error).message, 'error')
    })
  }

  useEffect(() => {
    loadSchema().catch((caught) => {
      setSchemaError(caught instanceof Error ? caught : new Error(String(caught)))
      showToast((caught as Error).message, 'error')
    })
  }, [connectionId, database, table, showToast])

  useAppAction('focus-filter', active ? () => filterInputRef.current?.focus() : null)
  useAppAction('refresh-view', active ? reloadSchema : null)

  const pendingColumnSQL = useMemo(() => {
    if (!editingColumn) return ''
    return buildAlterColumnSQL(sqlEngine, database, table, editingColumn)
  }, [database, editingColumn, sqlEngine, table])

  const pendingIndexSQL = useMemo(() => {
    if (!editingIndex) return ''
    return buildIndexSQL(sqlEngine, database, table, editingIndex)
  }, [database, editingIndex, sqlEngine, table])

  const filteredColumns = useMemo(() => {
    if (!schema) return []
    const query = structureQuery.trim().toLowerCase()
    if (!query) return schema.columns

    return schema.columns.filter((column) =>
      [column.name, column.type, column.comment, column.columnKey]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query))
    )
  }, [schema, structureQuery])

  const filteredIndexes = useMemo(() => {
    if (!schema) return []
    const query = structureQuery.trim().toLowerCase()
    if (!query) return schema.indexes

    return schema.indexes.filter((index) =>
      [index.name, index.type, index.columns.join(', '), index.unique ? t('common.yes') : t('common.no')]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query))
    )
  }, [schema, structureQuery, t])

  const startEditColumn = (column: ColumnInfo) => {
    setEditingColumn({
      originalName: column.name,
      name: column.name,
      type: column.type,
      nullable: column.nullable,
      defaultValue: column.defaultValue ?? '',
      useDefault: column.defaultValue !== null,
      comment: column.comment,
      isAutoIncrement: column.isAutoIncrement
    })
  }

  const reviewColumnSQL = () => {
    if (!editingColumn) return
    if (!editingColumn.name.trim() || !editingColumn.type.trim()) {
      showToast(t('tableStructure.columnRequired'), 'error')
      return
    }
    setPendingAction({
      title: t('tableStructure.confirmColumnChange'),
      description: t('tableStructure.reviewSqlForColumn', {
        db: database,
        table,
        column: editingColumn.originalName
      }),
      sql: pendingColumnSQL,
      successMessage: t('tableStructure.columnUpdated')
    })
  }

  const startAddIndex = () => {
    setEditingIndex({
      mode: 'add',
      name: '',
      columns: [],
      unique: false,
      primary: false,
      type: 'BTREE'
    })
  }

  const startEditIndex = (index: IndexInfo) => {
    setEditingIndex({
      mode: 'edit',
      originalName: index.name,
      name: index.name === 'PRIMARY' ? 'PRIMARY' : index.name,
      columns: [...index.columns],
      unique: index.unique,
      primary: index.name === 'PRIMARY',
      type: index.type || 'BTREE'
    })
  }

  const reviewIndexSQL = () => {
    if (!editingIndex) return
    if (!editingIndex.primary && !editingIndex.name.trim()) {
      showToast(t('tableStructure.indexNameRequired'), 'error')
      return
    }
    if (editingIndex.columns.length === 0) {
      showToast(t('tableStructure.selectAtLeastOneColumn'), 'error')
      return
    }
    setPendingAction({
      title: editingIndex.mode === 'add'
        ? t('tableStructure.confirmAddIndex')
        : t('tableStructure.confirmIndexChange'),
      description: `${database}.${table}`,
      sql: pendingIndexSQL,
      successMessage: editingIndex.mode === 'add'
        ? t('tableStructure.indexAdded')
        : t('tableStructure.indexUpdated')
    })
  }

  const reviewDeleteIndex = (index: IndexInfo) => {
    setPendingAction({
      title: t('tableStructure.confirmDeleteIndex'),
      description: `${database}.${table}.${index.name}`,
      sql: buildDropIndexSQL(sqlEngine, database, table, index.name),
      successMessage: t('tableStructure.indexDeleted', { name: index.name })
    })
  }

  const executePendingAction = async () => {
    if (!pendingAction) return
    setBusy(true)
    try {
      await unwrap(api.db.executeSQL(connectionId, pendingAction.sql, database))
      showToast(pendingAction.successMessage, 'success')
      setPendingAction(null)
      setEditingColumn(null)
      setEditingIndex(null)
      await loadSchema()
    } catch (error) {
      showToast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const copyCreateSQL = () => {
    if (!schema) return
    void navigator.clipboard.writeText(schema.createSQL)
    showToast(t('common.sqlCopied'), 'success')
  }

  const columnColumns = useMemo<Column<ColumnInfo>[]>(
    () => [
      { id: 'name', header: t('common.name'), mono: true, cell: (column) => column.name },
      {
        id: 'type',
        header: t('common.type'),
        mono: true,
        cell: (column) => <span className="text-fg-muted">{column.type}</span>
      },
      {
        id: 'null',
        header: t('tableStructure.columnHeaders.null'),
        cell: (column) => (column.nullable ? t('common.yes') : t('common.no'))
      },
      {
        id: 'default',
        header: t('tableStructure.columnHeaders.default'),
        mono: true,
        cell: (column) => column.defaultValue ?? <span className="opacity-50">NULL</span>
      },
      {
        id: 'key',
        header: t('tableStructure.columnHeaders.key'),
        cell: (column) =>
          column.isPrimaryKey ? (
            <Badge tone="warning">{t('tableStructure.pri')}</Badge>
          ) : column.columnKey ? (
            <Badge>{column.columnKey}</Badge>
          ) : null
      },
      {
        id: 'extra',
        header: t('tableStructure.columnHeaders.extra'),
        cell: (column) =>
          column.isAutoIncrement ? <Badge tone="accent">{t('tableStructure.autoInc')}</Badge> : null
      },
      {
        id: 'comment',
        header: t('common.comment'),
        truncate: true,
        cell: (column) => <span className="text-fg-muted">{column.comment}</span>
      },
      {
        id: 'actions',
        header: <span className="sr-only">{t('common.action')}</span>,
        align: 'right',
        width: 44,
        cell: (column) => (
          <RowMenu
            label={t('common.action')}
            items={[
              {
                id: 'edit-column',
                icon: Pencil,
                label: t('tableStructure.editColumn'),
                onSelect: () => startEditColumn(column)
              }
            ]}
          />
        )
      }
    ],
    [t]
  )

  const indexColumns = useMemo<Column<IndexInfo>[]>(
    () => [
      { id: 'name', header: t('common.name'), mono: true, cell: (index) => index.name },
      {
        id: 'columns',
        header: t('common.columns'),
        mono: true,
        truncate: true,
        cell: (index) => index.columns.join(', ')
      },
      {
        id: 'unique',
        header: t('tableStructure.indexHeaders.unique'),
        cell: (index) => (index.unique ? t('common.yes') : t('common.no'))
      },
      { id: 'type', header: t('common.type'), cell: (index) => index.type },
      {
        id: 'actions',
        header: <span className="sr-only">{t('common.action')}</span>,
        align: 'right',
        width: 44,
        cell: (index) => (
          <RowMenu
            label={t('common.action')}
            items={[
              {
                id: 'edit-index',
                icon: Pencil,
                label: t('tableStructure.editIndex'),
                onSelect: () => startEditIndex(index)
              },
              {
                id: 'drop-index',
                icon: Trash2,
                label: t('tableStructure.dropIndex'),
                danger: true,
                onSelect: () => reviewDeleteIndex(index)
              }
            ]}
          />
        )
      }
    ],
    [t]
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <Toolbar
        title={<span className="font-mono">{table}</span>}
        subtitle={[connectionName, database].filter(Boolean).join(' / ')}
        center={tabs}
        progress={schemaLoading ? { status: 'running', label: t('common.loading') } : null}
        overflowLabel={t('common.moreActions')}
        overflow={[
          {
            id: 'copy-create',
            icon: Copy,
            label: t('common.copySql'),
            disabled: !schema?.createSQL,
            disabledReason: t('common.loading'),
            onSelect: copyCreateSQL
          }
        ]}
        actions={
          <>
            <IconButton
              icon={RefreshCw}
              label={t('common.refresh')}
              shortcut="Mod+R"
              size="sm"
              variant="ghost"
              loading={schemaLoading}
              disabled={schemaLoading}
              onClick={reloadSchema}
            />
            <Button size="sm" variant="primary" icon={Plus} onClick={startAddIndex} disabled={!schema}>
              {t('tableStructure.addIndex')}
            </Button>
          </>
        }
        filters={
          <>
            <SearchInput
              ref={filterInputRef}
              size="sm"
              value={structureQuery}
              onValueChange={setStructureQuery}
              placeholder={t('tableStructure.searchPlaceholder')}
              clearLabel={t('common.clear')}
              containerClassName="min-w-[14rem] flex-[1_1_20rem]"
            />
            <span className="ml-auto flex items-center gap-1.5" aria-live="polite">
              <Badge>{t('tableStructure.columnCount', { count: schema?.columns.length ?? 0 })}</Badge>
              <Badge>{t('tableStructure.indexCount', { count: schema?.indexes.length ?? 0 })}</Badge>
              {schema && schema.primaryKey.length > 0 ? (
                <Badge tone="warning">
                  {t('tableStructure.primaryKey', { columns: schema.primaryKey.join(', ') })}
                </Badge>
              ) : null}
            </span>
          </>
        }
      />

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {schemaError && !schema ? (
          <EmptyState
            variant="error"
            title={t('tableStructure.loadFailed')}
            description={schemaError.message}
            error={schemaError}
            detailsLabel={t('common.details')}
            action={
              <Button variant="primary" icon={RefreshCw} onClick={reloadSchema}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : !schema ? (
          <Skeleton variant="row" count={8} />
        ) : (
          <>
            <Panel
              header={t('common.columns')}
              headerActions={
                <span className="text-xs text-fg-muted">
                  {t('tableStructure.visibleColumns', {
                    visible: filteredColumns.length,
                    total: schema.columns.length
                  })}
                </span>
              }
              padded={false}
            >
              <DataTable<ColumnInfo>
                aria-label={t('common.columns')}
                columns={columnColumns}
                rows={filteredColumns}
                rowKey={(column) => column.name}
                empty={
                  <EmptyState
                    size="sm"
                    variant="no-results"
                    title={t('tableStructure.noColumnsMatch')}
                    action={
                      <Button size="sm" variant="secondary" onClick={() => setStructureQuery('')}>
                        {t('tableData.clearFilter')}
                      </Button>
                    }
                  />
                }
              />
            </Panel>

            <Panel
              header={t('tableStructure.indexes')}
              headerActions={
                <>
                  <span className="text-xs text-fg-muted">
                    {t('tableStructure.visibleIndexes', {
                      visible: filteredIndexes.length,
                      total: schema.indexes.length
                    })}
                  </span>
                  <Button size="sm" variant="secondary" icon={Plus} onClick={startAddIndex}>
                    {t('tableStructure.addIndex')}
                  </Button>
                </>
              }
              padded={false}
            >
              <DataTable<IndexInfo>
                aria-label={t('tableStructure.indexes')}
                columns={indexColumns}
                rows={filteredIndexes}
                rowKey={(index) => index.name}
                empty={
                  <EmptyState
                    size="sm"
                    variant={schema.indexes.length === 0 ? 'first-run' : 'no-results'}
                    title={
                      schema.indexes.length === 0
                        ? t('tableStructure.noIndexes')
                        : t('tableStructure.noIndexesMatch')
                    }
                    action={
                      schema.indexes.length === 0 ? (
                        <Button size="sm" variant="primary" icon={Plus} onClick={startAddIndex}>
                          {t('tableStructure.addIndex')}
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => setStructureQuery('')}>
                          {t('tableData.clearFilter')}
                        </Button>
                      )
                    }
                  />
                }
              />
            </Panel>

            <Panel
              header="CREATE TABLE"
              headerActions={
                <Button size="sm" variant="secondary" icon={Copy} onClick={copyCreateSQL}>
                  {t('common.copy')}
                </Button>
              }
            >
              <pre className="max-h-[40vh] overflow-auto rounded-md border border-border bg-inset p-3 font-mono text-xs whitespace-pre">
                {schema.createSQL}
              </pre>
            </Panel>
          </>
        )}
      </div>

      {schema ? (
        <TableStructureDialogs
          database={database}
          table={table}
          busy={busy}
          columns={schema.columns}
          editingColumn={editingColumn}
          setEditingColumn={setEditingColumn}
          onReviewColumnSQL={reviewColumnSQL}
          editingIndex={editingIndex}
          setEditingIndex={setEditingIndex}
          onReviewIndexSQL={reviewIndexSQL}
          pendingAction={pendingAction}
          onClosePendingAction={() => setPendingAction(null)}
          onCopyPendingSQL={() => {
            if (!pendingAction) return
            void navigator.clipboard.writeText(pendingAction.sql)
            showToast(t('common.sqlCopied'), 'success')
          }}
          onExecutePendingAction={executePendingAction}
        />
      ) : null}
    </div>
  )
}

/** The persistent per-row `⋯` that replaced two inline buttons per row. */
function RowMenu({ items, label }: { items: MenuItem[]; label: string }) {
  return (
    <DropdownMenu
      items={items}
      side="bottom"
      align="end"
      aria-label={label}
      trigger={
        <IconButton
          icon={EllipsisVertical}
          label={label}
          size="xs"
          variant="ghost"
          tooltip={false}
          onClick={(event) => event.stopPropagation()}
        />
      }
    />
  )
}
