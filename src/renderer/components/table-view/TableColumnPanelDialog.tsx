import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Label } from '@renderer/components/ui/label'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Badge } from '@renderer/components/ui/badge'
import { useI18n } from '@renderer/i18n'
import type { ColumnInfo } from '../../../shared/types'

interface TableColumnPanelDialogProps {
  open: boolean
  columns: ColumnInfo[]
  visibleColumns: Set<string>
  visibleColumnCount: number
  onOpenChange: (open: boolean) => void
  onShowAllColumns: () => void
  onShowPrimaryColumns: () => void
  onToggleColumn: (columnName: string, visible: boolean) => void
}

export function TableColumnPanelDialog({
  open,
  columns,
  visibleColumns,
  visibleColumnCount,
  onOpenChange,
  onShowAllColumns,
  onShowPrimaryColumns,
  onToggleColumn
}: TableColumnPanelDialogProps) {
  const { t } = useI18n()
  const hasPrimaryColumns = columns.some((column) => column.isPrimaryKey)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('tableData.columnsPanel')}
      description={t('tableData.columnsPanelDescription')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onShowAllColumns}>
            {t('tableData.showAllColumns')}
          </Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
        </>
      }
    >
      <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-border bg-canvas px-3 py-2 text-xs text-fg-muted">
        <span>
          {t('tableData.columnsCount', {
            visible: visibleColumnCount,
            total: columns.length
          })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={onShowPrimaryColumns}
          disabled={!hasPrimaryColumns}
        >
          {t('tableData.showPrimaryColumns')}
        </Button>
      </div>
      <div className="grid max-h-[52vh] gap-2 overflow-auto pr-1 sm:grid-cols-2">
        {columns.map((column) => {
          const checked = visibleColumns.has(column.name)
          return (
            <Label
              key={column.name}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-canvas p-2 text-fg hover:bg-hover"
            >
              <Checkbox
                checked={checked}
                disabled={checked && visibleColumns.size <= 1}
                onChange={(event) => onToggleColumn(column.name, event.currentTarget.checked)}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 flex-wrap items-center gap-1">
                  <span className="truncate text-xs font-medium">{column.name}</span>
                  {column.isPrimaryKey && <Badge tone="warning">PK</Badge>}
                </span>
                <span className="block truncate font-mono text-2xs text-fg-subtle">{column.type}</span>
                {column.comment && (
                  <span className="block truncate text-2xs text-warning-text" title={column.comment}>
                    {column.comment}
                  </span>
                )}
              </span>
            </Label>
          )
        })}
      </div>
    </Dialog>
  )
}
