// One side of the table compare (blueprint §3.6).
//
// What changed in chunk 10:
//   · every row carries the mandatory `DiffGutter` (`+` / `−` / `~`) in its own
//     column — DS §1.5 makes the glyph the signal and the wash reinforcement;
//   · the amber/sky/violet literals are gone; the row wash and the changed-cell
//     highlight read `--ds-diff-*` through `DIFF_ROW_BG`, so the colourblind
//     preference (`data-colorblind-diff`) re-skins them for free;
//   · the pane shell is a `Panel`, and a load failure is an
//     `EmptyState variant="error"` with Retry instead of a bare red string;
//   · "Delete selected" left the pane header for the toolbar `⋯`, where both
//     sides' deletes sit together (§3.6).
import type { MouseEvent, Ref, UIEvent } from 'react'
import { ExternalLink } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { DiffGutter, DIFF_ROW_BG, type DiffKind } from '@renderer/components/ui/diff-gutter'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Panel } from '@renderer/components/ui/panel'
import { Spinner } from '@renderer/components/ui/spinner'
import { Table, TBody, Td, THead, Th, Tr } from '@renderer/components/ui/table'
import { cn, formatCellValue } from '@renderer/lib/utils'
import { formatNumber } from '@renderer/lib/format'
import { useI18n } from '@renderer/i18n'
import type { ColumnInfo, QueryRowsResult } from '../../../shared/types'
import { buildRowKey, type CompareColumn } from './table-compare-utils'
import type { AlignedCompareRow, RowDiffInfo } from './table-compare-diff'

/** Width of the diff-sign column. Identical on both panes so the rows line up. */
const GUTTER_WIDTH = 28
const SELECT_WIDTH = 44

interface TableComparePaneProps {
  title: string
  connectionName: string
  database: string
  table: string
  data: QueryRowsResult | null
  error: string | null
  loading: boolean
  onRetry?: () => void
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
  /** the merged per-aligned-row sign; see `table-compare-presentation` */
  rowDiffKindByKey?: Map<string, DiffKind>
  alignedRows?: AlignedCompareRow[] | null
  side?: 'source' | 'target'
  onOpenTable?: () => void
}

export function TableComparePane({
  title,
  connectionName,
  database,
  table,
  data,
  error,
  loading,
  onRetry,
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
  rowDiffKindByKey,
  alignedRows = null,
  side = 'source',
  onOpenTable
}: TableComparePaneProps) {
  const { t } = useI18n()
  const columns =
    compareColumns ??
    data?.columns.map((column) => ({
      name: column.name,
      [side]: column
    })) ??
    []
  const selectWidth = showSelection || leadingSpacer ? SELECT_WIDTH : 0
  const tableWidth =
    columns.reduce((total, column) => total + getCompareColumnWidth(column.name), 0) +
    selectWidth +
    GUTTER_WIDTH
  const rows = data ? getPaneRows(data, alignedRows, side) : []
  const leadingColumnCount = (selectWidth > 0 ? 1 : 0) + 1

  return (
    <Panel
      className="min-h-0 flex-1"
      padded={false}
      bodyClassName="min-h-0 flex-1 overflow-hidden"
      header={
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs font-normal text-fg-muted">{title}</span>
          <span className="shrink-0">{connectionName}</span>
          <span className="min-w-0 truncate font-mono text-xs font-normal text-fg-muted">
            {database} / {table}
          </span>
          {loading ? <Spinner size="xs" label={t('diff.pane.loadingRows')} /> : null}
        </span>
      }
      headerActions={
        <>
          {data ? (
            <span className="flex items-center gap-1.5 text-2xs text-fg-muted">
              <span>{t('diff.pane.rows', { count: formatNumber(data.total) })}</span>
              {data.hasPrimaryKey ? (
                <Badge>{t('diff.pane.pkPrefix', { columns: data.primaryKey.join(', ') })}</Badge>
              ) : (
                <Badge tone="warning">{t('diff.pane.noPrimaryKey')}</Badge>
              )}
            </span>
          ) : null}
          {onOpenTable ? (
            <IconButton
              icon={ExternalLink}
              size="xs"
              variant="ghost"
              onClick={onOpenTable}
              label={
                side === 'source'
                  ? t('diff.presentation.openSource')
                  : t('diff.presentation.openTarget')
              }
            />
          ) : null}
        </>
      }
    >
      <div
        ref={scrollContainerRef}
        onScroll={onScroll}
        aria-busy={loading || undefined}
        className="h-full min-h-0 overflow-auto"
      >
        {!loading && error ? (
          <EmptyState
            variant="error"
            size="sm"
            title={t('diff.pane.loadFailed')}
            error={error}
            detailsLabel={t('common.details')}
            action={
              onRetry ? (
                <Button size="sm" variant="secondary" onClick={onRetry}>
                  {t('common.retry')}
                </Button>
              ) : null
            }
          />
        ) : null}
        {data && (
          <Table className="table-fixed" style={{ width: tableWidth }}>
            <colgroup>
              {selectWidth > 0 && <col style={{ width: selectWidth }} />}
              <col style={{ width: GUTTER_WIDTH }} />
              {columns.map((column) => (
                <col key={column.name} style={{ width: getCompareColumnWidth(column.name) }} />
              ))}
            </colgroup>
            <THead>
              <Tr>
                {selectWidth > 0 && (
                  <Th className="h-14 w-11 align-middle">
                    <div className="flex h-full items-center">
                      {showSelection && (
                        <Checkbox
                          checked={allVisibleSelected}
                          onChange={() => onToggleAllVisible?.()}
                          disabled={!selectionEnabled}
                          aria-label={t('tableData.selectPageRows')}
                        />
                      )}
                    </div>
                  </Th>
                )}
                <Th className="h-14 align-middle">
                  <span className="sr-only">{t('diff.compareView.diffColumn')}</span>
                </Th>
                {columns.map((column) => {
                  const sideColumn = getSideColumn(column, side)
                  return (
                    <Th key={column.name} className="h-14 align-middle">
                      <div className="flex min-w-0 items-center gap-1 overflow-hidden leading-tight">
                        {sideColumn?.isPrimaryKey && <Badge tone="warning">PK</Badge>}
                        {!sideColumn && <Badge tone="danger">{t('diff.pane.missingColumn')}</Badge>}
                        <span className="shrink-0 truncate">{column.name}</span>
                        <span className="shrink-0 truncate text-2xs text-fg-muted">
                          {sideColumn?.type ?? t('diff.pane.notPresent')}
                        </span>
                      </div>
                    </Th>
                  )
                })}
              </Tr>
            </THead>
            <TBody>
              {rows.length === 0 && (
                <Tr>
                  <Td
                    colSpan={columns.length + leadingColumnCount}
                    className="h-11 text-xs text-fg-muted"
                  >
                    {t('diff.pane.noRowsOnPage')}
                  </Td>
                </Tr>
              )}
              {rows.map((entry, index) => {
                const rowKey = entry.key ?? `${title}-${index}`
                const row = entry.row
                const selected = row ? (selectedKeys?.has(rowKey) ?? false) : false
                const diffInfo = rowDiffByKey?.get(rowKey)
                const diffKind = rowDiffKindByKey?.get(rowKey) ?? 'same'

                return (
                  <Tr
                    key={rowKey}
                    data-diff={diffKind}
                    aria-selected={selected || undefined}
                    className={cn(!selected && DIFF_ROW_BG[diffKind], selected && 'bg-selected')}
                  >
                    {selectWidth > 0 && (
                      <Td>
                        {showSelection && row && (
                          <Checkbox
                            checked={selected}
                            onChange={() => undefined}
                            onClick={(event) => onToggleRow?.(row, event)}
                            disabled={!selectionEnabled}
                            aria-label={t('tableData.selectRow', { index: index + 1 })}
                          />
                        )}
                      </Td>
                    )}
                    <Td className="h-11">
                      <DiffGutter kind={diffKind} />
                    </Td>
                    {columns.map((column) => {
                      const sideColumn = getSideColumn(column, side)
                      const changed = Boolean(row && diffInfo?.changedColumns.has(column.name))
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
                            !row && 'bg-surface-2/10',
                            changed && 'bg-diff-mod-bg ring-1 ring-inset ring-diff-mod/40'
                          )}
                        >
                          {row && sideColumn ? (
                            renderCellValue(row[column.name], sideColumn.type)
                          ) : (
                            <span className="text-fg-muted">—</span>
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
    </Panel>
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
