// The two-pane body of the table compare (blueprint §3.6).
//
// The hand-rolled `grid xl:grid-cols-2` became `SplitPane direction="horizontal"`
// so the divider is draggable *and* keyboard-resizable (`role="separator"`,
// arrows, Home/End, double-click reset) and the ratio persists — the compare is
// exactly the screen where one side needs more room than the other.
//
// Synced scroll is preserved verbatim: `syncComparePaneScroll` maps the active
// pane's scroll ratio onto its peer, guarded by a one-frame re-entrancy flag so
// the peer's own `scroll` event does not bounce back.
import { useEffect, useMemo, useRef, type UIEvent } from 'react'
import { SplitPane } from '@renderer/components/ui/split-pane'
import { useI18n } from '@renderer/i18n'
import type { QueryRowsResult } from '../../../shared/types'
import { TableComparePane } from './TableComparePane'
import {
  syncComparePaneScroll,
  type AlignedCompareRow,
  type RowDiffLookup
} from './table-compare-diff'
import { buildRowDiffKinds } from './table-compare-presentation'
import type { CompareColumn } from './table-compare-utils'
import type { ComparePaneSelection } from './table-compare-selection'

export const TABLE_COMPARE_SPLIT_KEY = 'mysql-compare:table-compare-ratio'

export interface ComparePaneModel {
  connectionName: string
  database: string
  data: QueryRowsResult | null
  error: string | null
  loading: boolean
  selection: ComparePaneSelection
  onRetry: () => void
  onOpenTable: () => void
}

interface TableComparePanesProps {
  table: string
  source: ComparePaneModel
  target: ComparePaneModel
  compareColumns: CompareColumn[]
  rowDiffLookup: RowDiffLookup | null
  alignedRows: AlignedCompareRow[] | null
  /** page / table changes scroll both panes back to the top */
  scrollResetKey: string
}

export function TableComparePanes({
  table,
  source,
  target,
  compareColumns,
  rowDiffLookup,
  alignedRows,
  scrollResetKey
}: TableComparePanesProps) {
  const { t } = useI18n()
  const sourceScrollRef = useRef<HTMLDivElement | null>(null)
  const targetScrollRef = useRef<HTMLDivElement | null>(null)
  const syncScrollFrameRef = useRef<number | null>(null)
  const syncingScrollRef = useRef(false)

  useEffect(() => {
    // Assigning the two properties rather than calling `scrollTo` — same
    // effect, and `scrollTo` is not implemented in the test environment.
    for (const node of [sourceScrollRef.current, targetScrollRef.current]) {
      if (!node) continue
      node.scrollTop = 0
      node.scrollLeft = 0
    }
  }, [scrollResetKey])

  useEffect(() => {
    return () => {
      if (syncScrollFrameRef.current !== null) {
        cancelAnimationFrame(syncScrollFrameRef.current)
      }
    }
  }, [])

  const rowDiffKindByKey = useMemo(() => buildRowDiffKinds(rowDiffLookup), [rowDiffLookup])

  const syncPaneScroll = (side: 'source' | 'target', event: UIEvent<HTMLDivElement>) => {
    if (syncingScrollRef.current) return

    const activeElement = event.currentTarget
    const peerElement = side === 'source' ? targetScrollRef.current : sourceScrollRef.current

    if (!peerElement) return

    syncingScrollRef.current = true
    syncComparePaneScroll(activeElement, peerElement)

    if (syncScrollFrameRef.current !== null) {
      cancelAnimationFrame(syncScrollFrameRef.current)
    }

    syncScrollFrameRef.current = requestAnimationFrame(() => {
      syncingScrollRef.current = false
      syncScrollFrameRef.current = null
    })
  }

  return (
    // The padding lives on the wrapper, not on `SplitPane`: the primitive turns
    // its ratio into pixels from `clientWidth` (which includes padding), so
    // padding on the split container itself skews the divider position.
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
      <SplitPane
        direction="horizontal"
        storageKey={TABLE_COMPARE_SPLIT_KEY}
        defaultRatio={0.5}
        min={240}
        label={t('diff.compareView.splitLabel')}
        className="min-h-0 flex-1"
      >
        <div className="flex min-h-0 flex-1 flex-col pr-1">
          <TableComparePane
            title={t('diff.endpoint.source')}
            connectionName={source.connectionName}
            database={source.database}
            table={table}
            data={source.data}
            error={source.error}
            loading={source.loading}
            onRetry={source.onRetry}
            scrollContainerRef={sourceScrollRef}
            onScroll={(event) => syncPaneScroll('source', event)}
            selectedKeys={source.selection.selectedKeySet}
            showSelection={source.selection.selectionEnabled}
            selectionEnabled={source.selection.selectionEnabled}
            onToggleAllVisible={source.selection.toggleAllVisible}
            allVisibleSelected={source.selection.allVisibleSelected}
            onToggleRow={source.selection.toggleRow}
            compareColumns={compareColumns}
            rowDiffByKey={rowDiffLookup?.source}
            rowDiffKindByKey={rowDiffKindByKey}
            alignedRows={alignedRows}
            side="source"
            onOpenTable={source.onOpenTable}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col pl-1">
          <TableComparePane
            title={t('diff.endpoint.target')}
            connectionName={target.connectionName}
            database={target.database}
            table={table}
            data={target.data}
            error={target.error}
            loading={target.loading}
            onRetry={target.onRetry}
            scrollContainerRef={targetScrollRef}
            onScroll={(event) => syncPaneScroll('target', event)}
            // Keeps the two grids on the same baseline when only the source can
            // be selected (no primary key on the target).
            leadingSpacer={source.selection.selectionEnabled && !target.selection.selectionEnabled}
            selectedKeys={target.selection.selectedKeySet}
            showSelection={target.selection.selectionEnabled}
            selectionEnabled={target.selection.selectionEnabled}
            onToggleAllVisible={target.selection.toggleAllVisible}
            allVisibleSelected={target.selection.allVisibleSelected}
            onToggleRow={target.selection.toggleRow}
            compareColumns={compareColumns}
            rowDiffByKey={rowDiffLookup?.target}
            rowDiffKindByKey={rowDiffKindByKey}
            alignedRows={alignedRows}
            side="target"
            onOpenTable={target.onOpenTable}
          />
        </div>
      </SplitPane>
    </div>
  )
}
