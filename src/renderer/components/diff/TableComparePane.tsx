import type { MouseEvent, Ref, UIEvent } from 'react'
import { ExternalLink, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Table, TBody, Td, THead, Th, Tr } from '@renderer/components/ui/table'
import { cn, formatCellValue } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import type { ColumnInfo, QueryRowsResult } from '../../../shared/types'
import { buildRowKey, type CompareColumn } from './table-compare-utils'
import type { AlignedCompareRow, RowDiffInfo } from './table-compare-diff'

interface TableComparePaneProps {
  title: string
  connectionName: string
  database: string
  table: string
  data: QueryRowsResult | null
  error: string | null
  loading: boolean
  scrollContainerRef?: Ref<HTMLDivElement>
  onScroll?: (event: UIEvent<HTMLDivElement>) => void
  selectedKeys?: Set<string>
  showSelection?: boolean
  leadingSpacer?: boolean
  selectionEnabled?: boolean
  allVisibleSelected?: boolean
  onToggleAllVisible?: () => void
  onToggleRow?: (row: Record<string, unknown>, event: MouseEvent<HTMLInputElement>) => void
  compareColumns?: CompareColumn[]
  rowDiffByKey?: Map<string, RowDiffInfo>
  alignedRows?: AlignedCompareRow[] | null
  side?: 'source' | 'target'
  selectedCount?: number
  onOpenTable?: () => void
  onDeleteSelected?: () => void
  deleting?: boolean
}

export function TableComparePane({
  title,
  connectionName,
  database,
  table,
  data,
  error,
  loading,
  scrollContainerRef,
  onScroll,
  selectedKeys,
  showSelection = false,
  leadingSpacer = false,
  selectionEnabled = false,
  allVisibleSelected = false,
  onToggleAllVisible,
  onToggleRow,
  compareColumns,
  rowDiffByKey,
  alignedRows = null,
  side = 'source',
  selectedCount = 0,
  onOpenTable,
  onDeleteSelected,
  deleting = false
}: TableComparePaneProps) {
  const { t } = useI18n()
  const columns =
    compareColumns ??
    data?.columns.map((column) => ({
      name: column.name,
      [side]: column
    })) ??
    []
  const tableWidth =
    columns.reduce((total, column) => total + getCompareColumnWidth(column.name), 0) +
    (showSelection || leadingSpacer ? 44 : 0)

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded border border-border bg-card/40">
      <div className="border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="shrink-0 text-xs text-muted-foreground">{title}</span>
            <strong className="shrink-0 font-medium">{connectionName}</strong>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {database} / {table}
            </span>
            {loading && (
              <Loader2
                className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
                aria-label={t('diff.pane.loadingRows')}
              />
            )}
          </div>
          {data && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {onOpenTable && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={onOpenTable}
                  title={side === 'source' ? t('diff.presentation.openSource') : t('diff.presentation.openTarget')}
                  aria-label={side === 'source' ? t('diff.presentation.openSource') : t('diff.presentation.openTarget')}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              )}
              {showSelection && onDeleteSelected && (
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  disabled={selectedCount === 0 || deleting}
                  onClick={onDeleteSelected}
                  title={
                    deleting
                      ? t('diff.compareView.deleting')
                      : t('diff.compareView.deleteSelectedRows', { count: selectedCount })
                  }
                  aria-label={
                    deleting
                      ? t('diff.compareView.deleting')
                      : t('diff.compareView.deleteSelectedRows', { count: selectedCount })
                  }
                >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{t('diff.pane.rows', { count: data.total.toLocaleString() })}</span>
                <span>
                  {data.hasPrimaryKey
                    ? t('diff.pane.pkPrefix', { columns: data.primaryKey.join(', ') })
                    : t('diff.pane.noPrimaryKey')}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div ref={scrollContainerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto">
        {!loading && error && <div className="break-all p-3 text-xs text-destructive dark:text-red-300">{error}</div>}
        {data && (
          <Table className="table-fixed" style={{ width: tableWidth }}>
            <colgroup>
              {(showSelection || leadingSpacer) && <col style={{ width: 44 }} />}
              {columns.map((column) => (
                <col key={column.name} style={{ width: getCompareColumnWidth(column.name) }} />
              ))}
            </colgroup>
            <THead>
              <Tr>
                {(showSelection || leadingSpacer) && (
                  <Th className="h-14 w-11 align-middle">
                    <div className="flex h-full items-center">
                      {showSelection && (
                        <Checkbox
                          checked={allVisibleSelected}
                          onChange={() => onToggleAllVisible?.()}
                          disabled={!selectionEnabled}
                        />
                      )}
                    </div>
                  </Th>
                )}
                {columns.map((column) => {
                  const sideColumn = getSideColumn(column, side)
                  return (
                    <Th key={column.name} className="h-14 align-middle">
                      <div className="flex min-w-0 items-center gap-1 overflow-hidden leading-tight">
                        {sideColumn?.isPrimaryKey && <Badge variant="warning">PK</Badge>}
                        {!sideColumn && <Badge variant="destructive">{t('diff.pane.missingColumn')}</Badge>}
                        <span className="shrink-0 truncate">{column.name}</span>
                        <span className="shrink-0 truncate text-[10px] text-muted-foreground">
                          {sideColumn?.type ?? t('diff.pane.notPresent')}
                        </span>
                      </div>
                    </Th>
                  )
                })}
              </Tr>
            </THead>
            <TBody>
              {getPaneRows(data, alignedRows, side).length === 0 && (
                <Tr>
                  <Td colSpan={columns.length + (showSelection || leadingSpacer ? 1 : 0)} className="h-11 text-xs text-muted-foreground">
                    {t('diff.pane.noRowsOnPage')}
                  </Td>
                </Tr>
              )}
              {getPaneRows(data, alignedRows, side).map((entry, index) => {
                const rowKey = entry.key ?? `${title}-${index}`
                const row = entry.row
                const selected = row ? (selectedKeys?.has(rowKey) ?? false) : false
                const diffInfo = rowDiffByKey?.get(rowKey)

                return (
                  <Tr
                    key={rowKey}
                    className={cn(
                      selected && 'bg-accent/30',
                      !selected && !row && diffInfo?.status === 'source-only' && side === 'target' && 'bg-sky-500/10',
                      !selected && !row && diffInfo?.status === 'target-only' && side === 'source' && 'bg-violet-500/10',
                      !selected && row && diffInfo?.status === 'modified' && 'bg-amber-500/8',
                      !selected && row && diffInfo?.status === 'source-only' && 'bg-sky-500/10',
                      !selected && row && diffInfo?.status === 'target-only' && 'bg-violet-500/10'
                    )}
                  >
                    {(showSelection || leadingSpacer) && (
                      <Td>
                        {showSelection && row && (
                          <Checkbox
                            checked={selected}
                            onChange={() => undefined}
                            onClick={(event) => onToggleRow?.(row, event)}
                            disabled={!selectionEnabled}
                          />
                        )}
                      </Td>
                    )}
                    {columns.map((column) => {
                      const sideColumn = getSideColumn(column, side)
                      return (
                        <Td
                          key={column.name}
                          title={
                            row && sideColumn
                              ? renderCellValue(row[column.name], sideColumn.type)
                              : t('diff.pane.notPresent')
                          }
                          className={cn(
                            'h-11',
                            !row && 'bg-muted/10',
                            row &&
                              diffInfo?.changedColumns.has(column.name) &&
                              'bg-amber-400/25 ring-1 ring-inset ring-amber-500/50'
                          )}
                        >
                          {row && sideColumn ? (
                            renderCellValue(row[column.name], sideColumn.type)
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </Td>
                      )
                    })}
                  </Tr>
                )
              })}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  )
}

interface PaneRowEntry {
  key: string
  row: Record<string, unknown> | null
}

function getPaneRows(
  data: QueryRowsResult,
  alignedRows: AlignedCompareRow[] | null,
  side: 'source' | 'target'
): PaneRowEntry[] {
  if (alignedRows) {
    return alignedRows.map((entry) => ({
      key: entry.key,
      row: side === 'source' ? entry.sourceRow : entry.targetRow
    }))
  }

  return data.rows.map((row, index) => ({
    key: buildRowKey(row, data.primaryKey) ?? `${side}-${index}`,
    row
  }))
}

function getSideColumn(column: CompareColumn, side: 'source' | 'target'): ColumnInfo | undefined {
  return side === 'source' ? column.source : column.target
}

function getCompareColumnWidth(columnName: string): number {
  if (/^(id|.*_id)$/.test(columnName)) return 144
  if (/(created_at|updated_at|deleted_at|time|date)$/i.test(columnName)) return 220
  if (/(name|title|email|slug)$/i.test(columnName)) return 190
  return 180
}

function renderCellValue(value: unknown, columnType: string): string {
  if (value === null || value === undefined) return 'NULL'
  if (columnType === 'tinyint(1)') return value ? '✓' : '✗'
  return formatCellValue(value)
}
