// The grid's footer (blueprint §3.1).
//
// It is now `h-statusbar`-tall: counts on the left, paging on the right. The
// page-size `Select` moved into the toolbar's `⋯` (§1.3) because it is a
// set-once control that cannot fit a 24px band. Both callers now render it
// there — the table tab (chunk 7) and the table compare (chunk 10) — so this
// component no longer knows about `PAGE_SIZE_OPTIONS` at all.
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef } from 'react'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Input } from '@renderer/components/ui/input'
import { formatNumber } from '@renderer/lib/format'
import { useI18n } from '@renderer/i18n'

interface TableDataPaginationProps {
  totalRows: number
  totalIsExact?: boolean
  totalIsEstimate?: boolean
  hasMore?: boolean
  currentRowCount?: number
  usesOffset?: boolean
  pageSize?: number
  page: number
  totalPages: number
  pageDraft: string
  hiddenColumnCount: number
  onGoToPage: (page: number) => void
  onPageDraftChange: (value: string) => void
  onSubmitPageDraft: () => void
  onResetPageDraft: () => void
}

export function TableDataPagination({
  totalRows,
  totalIsExact = true,
  totalIsEstimate = true,
  hasMore,
  currentRowCount,
  usesOffset = true,
  pageSize,
  page,
  totalPages,
  pageDraft,
  hiddenColumnCount,
  onGoToPage,
  onPageDraftChange,
  onSubmitPageDraft,
  onResetPageDraft
}: TableDataPaginationProps) {
  const { t } = useI18n()
  const skipBlurSubmit = useRef(false)

  return (
    <div className="flex h-statusbar shrink-0 items-center justify-between gap-2 border-t border-border bg-surface px-2 text-xs text-fg-muted">
      <span className="truncate">
        {totalIsExact === false ? t(totalIsEstimate ? 'tableData.estimatedTotal' : 'tableData.unknownTotal', { count: formatNumber(totalRows) }) : pageSize ? t('tableData.rowRange', {
          start: formatNumber(totalRows === 0 ? 0 : (page - 1) * pageSize + 1),
          end: formatNumber(Math.min(page * pageSize, totalRows)),
          total: formatNumber(totalRows)
        }) : t('tableData.rowsPagination', {
          total: formatNumber(totalRows),
          page,
          totalPages
        })}
        {!totalIsExact && currentRowCount != null ? ` · ${t('tableData.pageWithoutTotal', { page })}` : null}
        {page > 100 && usesOffset ? <span className="ml-2 text-warning-text" title={t('tableData.deepPageHint')}>{t('tableData.deepPageHint')}</span> : null}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {hiddenColumnCount > 0 && (
          <span className="mr-1">{t('tableData.hiddenColumns', { count: hiddenColumnCount })}</span>
        )}
        <IconButton
          icon={ChevronLeft}
          label={t('common.prev')}
          size="xs"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => onGoToPage(page - 1)}
        />
        <Input
          type="number"
          size="sm"
          min={1}
          max={totalIsExact ? totalPages : undefined}
          step={1}
          value={pageDraft}
          onChange={(event) => onPageDraftChange(event.target.value)}
          onFocus={() => { skipBlurSubmit.current = false }}
          onBlur={() => {
            if (!skipBlurSubmit.current) onSubmitPageDraft()
            skipBlurSubmit.current = false
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              skipBlurSubmit.current = true
              onSubmitPageDraft()
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              skipBlurSubmit.current = true
              onResetPageDraft()
              event.currentTarget.blur()
            }
          }}
          aria-label={t('tableData.pageInput')}
          className="h-control-xs w-14 px-1 text-center text-xs"
        />
        {totalIsExact ? <span>/ {totalPages}</span> : null}
        <IconButton
          icon={ChevronRight}
          label={t('common.next')}
          size="xs"
          variant="ghost"
          disabled={hasMore === undefined ? page >= totalPages : !hasMore}
          onClick={() => onGoToPage(page + 1)}
        />
      </div>
    </div>
  )
}
