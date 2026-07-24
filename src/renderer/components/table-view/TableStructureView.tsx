// 表结构视图：字段、索引、CREATE TABLE，并支持列/索引结构修改。
import { useEffect, useMemo, useState } from 'react'
import { Copy, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Table, TBody, THead, Th, Tr, Td } from '@renderer/components/ui/table'
import { Badge } from '@renderer/components/ui/badge'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import { cn } from '@renderer/lib/utils'
import type { ColumnInfo, DbEngine, IndexInfo, TableSchema } from '../../../shared/types'
import { TableStructureDialogs } from './TableStructureDialogs'
import {
  buildAlterColumnSQL,
  buildDropIndexSQL,
  buildIndexSQL
} from './table-structure-sql'
import type { ColumnDraft, IndexDraft, PendingAction } from './table-structure-types'

interface Props {
  connectionId: string
  database: string
  table: string
  engine?: DbEngine
}

export function TableStructureView({ connectionId, database, table, engine = 'mysql' }: Props) {
  const sqlEngine = engine === 'postgres' ? 'postgres' : 'mysql'
  const { showToast } = useUIStore()
  const { t } = useI18n()
  const [schema, setSchema] = useState<TableSchema | null>(null)
  const [editingColumn, setEditingColumn] = useState<ColumnDraft | null>(null)
  const [editingIndex, setEditingIndex] = useState<IndexDraft | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [structureQuery, setStructureQuery] = useState('')
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const loadSchema = async () => {
    setSchemaLoading(true)
    try {
      const next = await unwrap<TableSchema>(api.schema.getTable(connectionId, database, table))
      setSchema(next)
    } finally {
      setSchemaLoading(false)
    }
  }

  useEffect(() => {
    loadSchema().catch((e) => showToast((e as Error).message, 'error'))
  }, [connectionId, database, table, showToast])

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

  if (!schema) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-3 text-xs text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/70 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge>{t('tableStructure.columnCount', { count: schema.columns.length })}</Badge>
          <Badge>{t('tableStructure.indexCount', { count: schema.indexes.length })}</Badge>
          {schema.primaryKey.length > 0 && (
            <Badge variant="warning">{t('tableStructure.primaryKey', { columns: schema.primaryKey.join(', ') })}</Badge>
          )}
        </div>
        <div className="flex min-w-[18rem] flex-1 items-center justify-end gap-2">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={structureQuery}
              onChange={(event) => setStructureQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setStructureQuery('')
              }}
              placeholder={t('tableStructure.searchPlaceholder')}
              className="h-8 pl-8 pr-8 text-xs"
            />
            {structureQuery && (
              <button
                type="button"
                className="absolute right-2 top-1/2 rounded p-0.5 text-muted-foreground -translate-y-1/2 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => setStructureQuery('')}
                title={t('common.clear')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => loadSchema().catch((e) => showToast((e as Error).message, 'error'))} disabled={schemaLoading}>
            <RefreshCw className={cn('h-4 w-4', schemaLoading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3 pb-8">
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t('common.columns')}</h3>
          <span className="text-xs text-muted-foreground">
            {t('tableStructure.visibleColumns', { visible: filteredColumns.length, total: schema.columns.length })}
          </span>
        </div>
        <Table>
          <THead>
            <Tr>
              <Th>{t('common.name')}</Th>
              <Th>{t('common.type')}</Th>
              <Th>{t('tableStructure.columnHeaders.null')}</Th>
              <Th>{t('tableStructure.columnHeaders.default')}</Th>
              <Th>{t('tableStructure.columnHeaders.key')}</Th>
              <Th>{t('tableStructure.columnHeaders.extra')}</Th>
              <Th>{t('common.comment')}</Th>
              <Th className="w-20">{t('common.action')}</Th>
            </Tr>
          </THead>
          <TBody>
            {filteredColumns.map((column) => (
              <Tr key={column.name}>
                <Td>{column.name}</Td>
                <Td className="text-muted-foreground">{column.type}</Td>
                <Td>{column.nullable ? t('common.yes') : t('common.no')}</Td>
                <Td>{column.defaultValue ?? <span className="opacity-50">NULL</span>}</Td>
                <Td>
                  {column.isPrimaryKey && <Badge variant="warning">{t('tableStructure.pri')}</Badge>}
                  {!column.isPrimaryKey && column.columnKey && <Badge>{column.columnKey}</Badge>}
                </Td>
                <Td>{column.isAutoIncrement && <Badge variant="info">{t('tableStructure.autoInc')}</Badge>}</Td>
                <Td className="text-muted-foreground">{column.comment}</Td>
                <Td>
                  <Button size="sm" variant="outline" onClick={() => startEditColumn(column)}>
                    <Pencil className="h-3 w-3" /> {t('common.edit')}
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        {filteredColumns.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t('tableStructure.noColumnsMatch')}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t('tableStructure.indexes')}</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t('tableStructure.visibleIndexes', { visible: filteredIndexes.length, total: schema.indexes.length })}
            </span>
            <Button size="sm" variant="outline" onClick={startAddIndex}>
              <Plus className="h-3.5 w-3.5" /> {t('tableStructure.addIndex')}
            </Button>
          </div>
        </div>
        <Table>
          <THead>
            <Tr>
              <Th>{t('common.name')}</Th>
              <Th>{t('common.columns')}</Th>
              <Th>{t('tableStructure.indexHeaders.unique')}</Th>
              <Th>{t('common.type')}</Th>
              <Th className="w-36">{t('common.action')}</Th>
            </Tr>
          </THead>
          <TBody>
            {filteredIndexes.map((index) => (
              <Tr key={index.name}>
                <Td>{index.name}</Td>
                <Td>{index.columns.join(', ')}</Td>
                <Td>{index.unique ? t('common.yes') : t('common.no')}</Td>
                <Td>{index.type}</Td>
                <Td>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => startEditIndex(index)}>
                      <Pencil className="h-3 w-3" /> {t('common.edit')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => reviewDeleteIndex(index)}>
                      <Trash2 className="h-3 w-3" /> {t('common.delete')}
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        {filteredIndexes.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {schema.indexes.length === 0 ? t('tableStructure.noIndexes') : t('tableStructure.noIndexesMatch')}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">CREATE TABLE</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(schema.createSQL)
              showToast(t('common.sqlCopied'), 'success')
            }}
          >
            <Copy className="w-3 h-3" /> {t('common.copy')}
          </Button>
        </div>
        <pre className="overflow-auto whitespace-pre rounded border border-border bg-card p-3 text-xs">
{schema.createSQL}
        </pre>
      </section>
      </div>

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
          navigator.clipboard.writeText(pendingAction.sql)
          showToast(t('common.sqlCopied'), 'success')
        }}
        onExecutePendingAction={executePendingAction}
      />
    </div>
  )
}
