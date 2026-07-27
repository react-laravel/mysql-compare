import type { Dispatch, SetStateAction } from 'react'
import { Copy } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { useI18n } from '@renderer/i18n'
import type { ColumnInfo } from '../../../shared/types'
import type { ColumnDraft, IndexDraft, PendingAction } from './table-structure-types'

interface TableStructureDialogsProps {
  database: string
  table: string
  busy: boolean
  columns: ColumnInfo[]
  editingColumn: ColumnDraft | null
  setEditingColumn: Dispatch<SetStateAction<ColumnDraft | null>>
  onReviewColumnSQL: () => void
  editingIndex: IndexDraft | null
  setEditingIndex: Dispatch<SetStateAction<IndexDraft | null>>
  onReviewIndexSQL: () => void
  pendingAction: PendingAction | null
  onClosePendingAction: () => void
  onCopyPendingSQL: () => void
  onExecutePendingAction: () => void | Promise<void>
}

export function TableStructureDialogs({
  database,
  table,
  busy,
  columns,
  editingColumn,
  setEditingColumn,
  onReviewColumnSQL,
  editingIndex,
  setEditingIndex,
  onReviewIndexSQL,
  pendingAction,
  onClosePendingAction,
  onCopyPendingSQL,
  onExecutePendingAction
}: TableStructureDialogsProps) {
  const { t } = useI18n()

  return (
    <>
      {editingColumn && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) {
              setEditingColumn(null)
            }
          }}
          title={t('columnDialog.editTitle')}
          description={`${database}.${table}.${editingColumn.originalName}`}
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditingColumn(null)} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" onClick={onReviewColumnSQL} disabled={busy}>
                {t('common.reviewSql')}
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block">{t('columnDialog.columnName')}</Label>
              <Input
                value={editingColumn.name}
                onChange={(event) =>
                  setEditingColumn((current) =>
                    current ? { ...current, name: event.target.value } : current
                  )
                }
              />
            </div>
            <div>
              <Label className="mb-1 block">{t('common.type')}</Label>
              <Input
                value={editingColumn.type}
                onChange={(event) =>
                  setEditingColumn((current) =>
                    current ? { ...current, type: event.target.value } : current
                  )
                }
              />
            </div>
            <div className="col-span-2 flex items-center gap-4 pt-1 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={editingColumn.nullable}
                  onChange={(event) =>
                    setEditingColumn((current) =>
                      current ? { ...current, nullable: event.target.checked } : current
                    )
                  }
                />
                {t('columnDialog.nullable')}
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={editingColumn.useDefault}
                  onChange={(event) =>
                    setEditingColumn((current) =>
                      current ? { ...current, useDefault: event.target.checked } : current
                    )
                  }
                />
                {t('columnDialog.setDefault')}
              </label>
              {editingColumn.isAutoIncrement && <Badge tone="accent">{t('columnDialog.autoIncPreserved')}</Badge>}
            </div>
            <div className="col-span-2">
              <Label className="mb-1 block">{t('columnDialog.defaultValue')}</Label>
              <Input
                value={editingColumn.defaultValue}
                onChange={(event) =>
                  setEditingColumn((current) =>
                    current ? { ...current, defaultValue: event.target.value } : current
                  )
                }
                disabled={!editingColumn.useDefault}
                placeholder={t('columnDialog.defaultNullHint')}
              />
            </div>
            <div className="col-span-2">
              <Label className="mb-1 block">{t('common.comment')}</Label>
              <Input
                value={editingColumn.comment}
                onChange={(event) =>
                  setEditingColumn((current) =>
                    current ? { ...current, comment: event.target.value } : current
                  )
                }
              />
            </div>
          </div>
        </Dialog>
      )}

      {editingIndex && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) {
              setEditingIndex(null)
            }
          }}
          title={editingIndex.mode === 'add' ? t('indexDialog.addTitle') : t('indexDialog.editTitle')}
          description={`${database}.${table}`}
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditingIndex(null)} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" onClick={onReviewIndexSQL} disabled={busy}>
                {t('common.reviewSql')}
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block">{t('indexDialog.indexName')}</Label>
              <Input
                value={editingIndex.name}
                onChange={(event) =>
                  setEditingIndex((current) =>
                    current ? { ...current, name: event.target.value } : current
                  )
                }
                disabled={editingIndex.primary}
                placeholder={editingIndex.primary ? 'PRIMARY' : 'idx_example'}
              />
            </div>
            <div>
              <Label className="mb-1 block">{t('indexDialog.indexType')}</Label>
              <Input
                value={editingIndex.type}
                onChange={(event) =>
                  setEditingIndex((current) =>
                    current ? { ...current, type: event.target.value.toUpperCase() } : current
                  )
                }
                disabled={editingIndex.primary}
                placeholder="BTREE"
              />
            </div>
            <div className="col-span-2 flex items-center gap-4 pt-1 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={editingIndex.primary}
                  onChange={(event) =>
                    setEditingIndex((current) => {
                      if (!current) return current
                      const primary = event.target.checked
                      return {
                        ...current,
                        primary,
                        unique: primary ? true : current.unique,
                        name: primary ? 'PRIMARY' : current.originalName === 'PRIMARY' ? '' : current.name
                      }
                    })
                  }
                />
                {t('indexDialog.primaryKey')}
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={editingIndex.unique || editingIndex.primary}
                  onChange={(event) =>
                    setEditingIndex((current) =>
                      current && !current.primary
                        ? { ...current, unique: event.target.checked }
                        : current
                    )
                  }
                  disabled={editingIndex.primary}
                />
                {t('indexDialog.unique')}
              </label>
            </div>
            <div className="col-span-2 space-y-2">
              <Label className="block">{t('common.columns')}</Label>
              <div className="grid max-h-48 grid-cols-2 gap-2 overflow-auto rounded border border-border p-3 text-sm">
                {columns.map((column) => (
                  <label key={column.name} className="flex items-center gap-2">
                    <Checkbox
                      checked={editingIndex.columns.includes(column.name)}
                      onChange={(event) =>
                        setEditingIndex((current) => {
                          if (!current) return current
                          const nextColumns = event.target.checked
                            ? [...current.columns, column.name]
                            : current.columns.filter((name) => name !== column.name)
                          return { ...current, columns: nextColumns }
                        })
                      }
                    />
                    {column.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </Dialog>
      )}

      {pendingAction && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) onClosePendingAction()
          }}
          title={pendingAction.title}
          description={pendingAction.description}
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={onClosePendingAction} disabled={busy}>
                {t('common.back')}
              </Button>
              <Button variant="secondary" onClick={onCopyPendingSQL} disabled={busy}>
                <Copy className="h-3 w-3" /> {t('common.copySql')}
              </Button>
              <Button variant="primary" onClick={onExecutePendingAction} disabled={busy}>
                {busy ? t('tableInfo.executing') : t('common.confirmExecute')}
              </Button>
            </>
          }
        >
          <pre className="max-h-[60vh] overflow-auto rounded border border-border bg-surface p-3 text-xs whitespace-pre-wrap break-all">
            {pendingAction.sql}
          </pre>
        </Dialog>
      )}
    </>
  )
}