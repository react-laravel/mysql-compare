import { useState, type MutableRefObject } from 'react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Dialog } from '@renderer/components/ui/dialog'
import { Table, TBody, THead, Th, Tr, Td } from '@renderer/components/ui/table'
import { useI18n } from '@renderer/i18n'
import { cn, formatCellValue } from '@renderer/lib/utils'
import { Braces, ClipboardCopy, Pencil, RefreshCw } from 'lucide-react'
import type { ColumnInfo, QueryRowsResult } from '../../../shared/types'
import { renderTableCellValue } from './table-cell-render'

interface TableDataGridProps {
  data: QueryRowsResult | null
  loading: boolean
  visibleColumns: ColumnInfo[]
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
  density: 'compact' | 'comfortable'
  wrapCells: boolean
  selected: Set<number>
  allRowsOnPageSelected: boolean
  someRowsOnPageSelected: boolean
  readOnly?: boolean
  sortable?: boolean
  selectionShiftPressedRef: MutableRefObject<boolean>
  onToggleSelectPage: () => void
  onSort: (column: string) => void
  onRowClick: (rowIndex: number, shiftKey: boolean) => void
  onStartEdit: (row: Record<string, unknown>) => void
  onToggleSelect: (rowIndex: number, shiftKey: boolean) => void
}

export function TableDataGrid({
  data,
  loading,
  visibleColumns,
  orderBy,
  density,
  wrapCells,
  selected,
  allRowsOnPageSelected,
  someRowsOnPageSelected,
  readOnly = false,
  sortable = true,
  selectionShiftPressedRef,
  onToggleSelectPage,
  onSort,
  onRowClick,
  onStartEdit,
  onToggleSelect
}: TableDataGridProps) {
  const { t } = useI18n()
  const [jsonViewer, setJsonViewer] = useState<{ title: string; content: string } | null>(null)

  const copyJsonViewerContent = async () => {
    if (!jsonViewer) return
    await navigator.clipboard.writeText(jsonViewer.content)
  }

  return (
    <div className="relative flex-1 overflow-auto">
      {loading && data && (
        <div className="absolute right-3 top-3 z-20 flex items-center gap-2 rounded-md border border-border bg-card/95 px-2 py-1 text-xs text-muted-foreground shadow-sm">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          {t('common.loading')}
        </div>
      )}
      {loading && !data && (
        <div className="flex h-full items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          {t('common.loading')}
        </div>
      )}
      {!loading && data && data.rows.length === 0 && (
        <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
          {t('tableData.noRowsMatched')}
        </div>
      )}
      {data && (
        <Table>
          <THead>
            <Tr>
              {!readOnly && (
                <>
                  <Th className="sticky left-0 z-20 w-8 bg-card">
                    <Checkbox
                      ref={(element) => {
                        if (element) element.indeterminate = someRowsOnPageSelected
                      }}
                      checked={allRowsOnPageSelected}
                      disabled={!data.hasPrimaryKey || data.rows.length === 0}
                      aria-label={t('tableData.selectPageRows')}
                      onChange={onToggleSelectPage}
                    />
                  </Th>
                  <Th className="sticky left-8 z-20 w-8 bg-card" />
                </>
              )}
              {visibleColumns.map((column) => (
                <Th
                  key={column.name}
                  className={cn(sortable && 'cursor-pointer select-none')}
                  onClick={() => {
                    if (sortable) onSort(column.name)
                  }}
                  aria-sort={
                    orderBy?.column === column.name
                      ? orderBy.dir === 'ASC'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  title={sortable ? t('tableData.sortColumn') : undefined}
                >
                  <div className="flex flex-col items-start gap-1 whitespace-normal py-1 leading-tight">
                    <div className="flex flex-wrap items-center gap-1">
                      {column.isPrimaryKey && <Badge variant="warning">PK</Badge>}
                      <span>{column.name}</span>
                      <span className="text-[10px] text-muted-foreground">{column.type}</span>
                      {orderBy?.column === column.name && (
                        <span className="text-[10px]">{orderBy.dir === 'ASC' ? '▲' : '▼'}</span>
                      )}
                    </div>
                    {column.comment && (
                      <span
                        className="max-w-[14rem] truncate text-[10px] font-normal text-amber-300/90"
                        title={column.comment}
                      >
                        {column.comment}
                      </span>
                    )}
                  </div>
                </Th>
              ))}
            </Tr>
          </THead>
          <TBody>
            {data.rows.map((row, index) => (
              <Tr
                key={index}
                className={cn(
                  'group',
                  !readOnly && data.hasPrimaryKey && 'cursor-pointer',
                  selected.has(index) && 'bg-accent/70 hover:bg-accent/80'
                )}
                onClick={(event) => {
                  if (!readOnly) onRowClick(index, event.shiftKey)
                }}
                onDoubleClick={() => {
                  if (!readOnly && data.hasPrimaryKey) onStartEdit(row)
                }}
              >
                {!readOnly && (
                  <>
                    <Td
                      className={cn(
                        'sticky left-0 z-10 bg-background group-hover:bg-muted/40',
                        selected.has(index) && 'bg-accent/70 group-hover:bg-accent/80'
                      )}
                    >
                      <Checkbox
                        checked={selected.has(index)}
                        aria-label={t('tableData.selectRow', { index: index + 1 })}
                        onClick={(event) => {
                          event.stopPropagation()
                          selectionShiftPressedRef.current = event.shiftKey
                        }}
                        onChange={() => {
                          const shiftKey = selectionShiftPressedRef.current
                          selectionShiftPressedRef.current = false
                          onToggleSelect(index, shiftKey)
                        }}
                        disabled={!data.hasPrimaryKey}
                      />
                    </Td>
                    <Td
                      className={cn(
                        'sticky left-8 z-10 bg-background group-hover:bg-muted/40',
                        selected.has(index) && 'bg-accent/70 group-hover:bg-accent/80'
                      )}
                    >
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          onStartEdit(row)
                        }}
                        className="text-muted-foreground hover:text-foreground"
                        disabled={!data.hasPrimaryKey}
                        title={data.hasPrimaryKey ? t('tableData.editRow') : t('tableData.noPk')}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </Td>
                  </>
                )}
                {visibleColumns.map((column) => (
                  <Td
                    key={column.name}
                    title={formatCellValue(row[column.name])}
                    className={cn(
                      density === 'comfortable' && 'py-2.5',
                      wrapCells
                        ? 'max-w-md whitespace-pre-wrap break-words overflow-visible text-clip align-top'
                        : 'max-w-xs truncate whitespace-nowrap'
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-1.5">
                      <span className={cn('min-w-0', wrapCells ? 'whitespace-pre-wrap break-words' : 'truncate')}>
                        {renderTableCellValue(row[column.name], column)}
                      </span>
                      {getFormattedJson(row[column.name]) && (
                        <button
                          type="button"
                          className="shrink-0 rounded border border-border bg-background p-1 text-muted-foreground hover:text-foreground"
                          title={t('tableData.viewJson')}
                          onClick={(event) => {
                            event.stopPropagation()
                            const content = getFormattedJson(row[column.name])
                            if (content) setJsonViewer({ title: column.name, content })
                          }}
                        >
                          <Braces className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {jsonViewer && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setJsonViewer(null)
          }}
          title={t('tableData.jsonViewerTitle')}
          description={jsonViewer.title}
          className="max-w-4xl"
          footer={
            <>
              <Button variant="outline" onClick={() => setJsonViewer(null)}>
                {t('common.close')}
              </Button>
              <Button onClick={copyJsonViewerContent}>
                <ClipboardCopy className="h-4 w-4" /> {t('tableData.copyJson')}
              </Button>
            </>
          }
        >
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs">
            {jsonViewer.content}
          </pre>
        </Dialog>
      )}
    </div>
  )
}

function getFormattedJson(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return null
  }
}