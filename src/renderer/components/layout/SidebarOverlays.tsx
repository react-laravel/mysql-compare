import { CircleEllipsis, Copy, Download, Eraser, FileCode2, Pencil, RefreshCw, Upload } from 'lucide-react'
import { ConnectionDialog } from '@renderer/components/connection/ConnectionDialog'
import { ExportDatabaseDialog } from '@renderer/components/table-view/ExportDatabaseDialog'
import { ExportTableDialog } from '@renderer/components/table-view/ExportTableDialog'
import { ImportTableDialog } from '@renderer/components/table-view/ImportTableDialog'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import type { SafeConnection } from '../../../shared/types'
import type {
  CreateSQLDialogState,
  DatabaseMenuState,
  ExportDatabaseDialogState,
  ExportDialogState,
  ImportDialogState,
  RenameDialogState,
  TableMenuState
} from './sidebar-types'

interface SidebarOverlaysProps {
  creating: boolean
  editing: SafeConnection | null
  onConnectionDialogOpenChange: (open: boolean) => void
  onConnectionSaved: () => void
  onDeleteConnection: (connection: SafeConnection) => boolean | Promise<boolean>
  tableMenu: TableMenuState | null
  onCloseTableMenu: () => void
  databaseMenu: DatabaseMenuState | null
  onCloseDatabaseMenu: () => void
  onOpenDatabaseDetails: (menu: DatabaseMenuState) => void
  onOpenDatabaseSQLConsole: (menu: DatabaseMenuState) => void
  onExportDatabase: (menu: DatabaseMenuState) => void
  onRefreshDatabase: (menu: DatabaseMenuState) => void | Promise<void>
  onOpenTableDetails: (menu: TableMenuState) => void
  onRenameTable: (menu: TableMenuState) => void
  onCopyTable: (menu: TableMenuState) => void | Promise<void>
  onShowCreateSQL: (menu: TableMenuState) => void | Promise<void>
  onExportTable: (menu: TableMenuState) => void
  onImportTable: (menu: TableMenuState) => void
  onTruncateTable: (menu: TableMenuState) => void | Promise<void>
  renameDialog: RenameDialogState | null
  renameDraft: string
  actionBusy: boolean
  onRenameDraftChange: (value: string) => void
  onRenameDialogOpenChange: (open: boolean) => void
  onSubmitRename: () => void | Promise<void>
  createSQLDialog: CreateSQLDialogState | null
  onCreateSQLDialogOpenChange: (open: boolean) => void
  onCopyCreateSQL: () => void
  exportDialog: ExportDialogState | null
  onExportDialogOpenChange: (open: boolean) => void
  exportDatabaseDialog: ExportDatabaseDialogState | null
  onExportDatabaseDialogOpenChange: (open: boolean) => void
  importDialog: ImportDialogState | null
  onImportDialogOpenChange: (open: boolean) => void
  onImported: () => void | Promise<void>
}

export function SidebarOverlays({
  creating,
  editing,
  onConnectionDialogOpenChange,
  onConnectionSaved,
  onDeleteConnection,
  tableMenu,
  onCloseTableMenu,
  databaseMenu,
  onCloseDatabaseMenu,
  onOpenDatabaseDetails,
  onOpenDatabaseSQLConsole,
  onExportDatabase,
  onRefreshDatabase,
  onOpenTableDetails,
  onRenameTable,
  onCopyTable,
  onShowCreateSQL,
  onExportTable,
  onImportTable,
  onTruncateTable,
  renameDialog,
  renameDraft,
  actionBusy,
  onRenameDraftChange,
  onRenameDialogOpenChange,
  onSubmitRename,
  createSQLDialog,
  onCreateSQLDialogOpenChange,
  onCopyCreateSQL,
  exportDialog,
  onExportDialogOpenChange,
  exportDatabaseDialog,
  onExportDatabaseDialogOpenChange,
  importDialog,
  onImportDialogOpenChange,
  onImported
}: SidebarOverlaysProps) {
  const { t } = useI18n()
  const tableIsRedis = tableMenu?.connection.engine === 'redis'
  const databaseIsRedis = databaseMenu?.connection.engine === 'redis'
  return (
    <>
      {(creating || editing) && (
        <ConnectionDialog
          open
          connection={editing}
          onOpenChange={onConnectionDialogOpenChange}
          onSaved={onConnectionSaved}
          onDelete={onDeleteConnection}
        />
      )}

      {tableMenu && (
        <div className="fixed inset-0 z-[80]" onClick={onCloseTableMenu}>
          <div
            className="absolute w-56 rounded-md border border-border bg-card p-1 shadow-xl"
            style={{ left: tableMenu.x, top: tableMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <TableMenuItem
              icon={<CircleEllipsis className="h-3.5 w-3.5" />}
              label={t('sidebar.overlays.tableDetails')}
              onClick={() => onOpenTableDetails(tableMenu)}
            />
            {!tableIsRedis && (
              <>
                <div className="my-1 h-px bg-border" />
                <TableMenuItem
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.renameTable')}
                  onClick={() => onRenameTable(tableMenu)}
                />
                <TableMenuItem
                  icon={<Copy className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.copyToCopy', { table: tableMenu.table })}
                  onClick={() => onCopyTable(tableMenu)}
                />
                <TableMenuItem
                  icon={<FileCode2 className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.showCreateTable')}
                  onClick={() => onShowCreateSQL(tableMenu)}
                />
                <TableMenuItem
                  icon={<Download className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.exportEllipsis')}
                  onClick={() => onExportTable(tableMenu)}
                />
                <TableMenuItem
                  icon={<Upload className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.importEllipsis')}
                  onClick={() => onImportTable(tableMenu)}
                />
                <div className="my-1 h-px bg-border" />
                <TableMenuItem
                  icon={<Eraser className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.truncateTable')}
                  onClick={() => onTruncateTable(tableMenu)}
                  danger
                />
              </>
            )}
          </div>
        </div>
      )}

      {databaseMenu && (
        <div className="fixed inset-0 z-[80]" onClick={onCloseDatabaseMenu}>
          <div
            className="absolute w-56 rounded-md border border-border bg-card p-1 shadow-xl"
            style={{ left: databaseMenu.x, top: databaseMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <TableMenuItem
              icon={<CircleEllipsis className="h-3.5 w-3.5" />}
              label={t('sidebar.overlays.databaseDetails')}
              onClick={() => onOpenDatabaseDetails(databaseMenu)}
            />
            {!databaseIsRedis && (
              <>
                <div className="my-1 h-px bg-border" />
                <TableMenuItem
                  icon={<FileCode2 className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.openSqlConsole')}
                  onClick={() => onOpenDatabaseSQLConsole(databaseMenu)}
                />
                <TableMenuItem
                  icon={<Download className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.exportDatabase')}
                  onClick={() => onExportDatabase(databaseMenu)}
                />
              </>
            )}
            <TableMenuItem
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              label={t('common.refresh')}
              onClick={() => onRefreshDatabase(databaseMenu)}
            />
          </div>
        </div>
      )}

      {renameDialog && (
        <Dialog
          open
          onOpenChange={onRenameDialogOpenChange}
          title={t('sidebar.overlays.renameTable')}
          description={t('sidebar.overlays.renameDescription', {
            db: renameDialog.database,
            table: renameDialog.table
          })}
          className="max-w-md"
          footer={
            <>
              <Button variant="outline" onClick={() => onRenameDialogOpenChange(false)} disabled={actionBusy}>
                {t('common.cancel')}
              </Button>
              <Button onClick={onSubmitRename} disabled={actionBusy || !renameDraft.trim()}>
                {t('common.rename')}
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            <Label className="block">{t('sidebar.overlays.newTableName')}</Label>
            <Input value={renameDraft} onChange={(event) => onRenameDraftChange(event.target.value)} />
          </div>
        </Dialog>
      )}

      {createSQLDialog && (
        <Dialog
          open
          onOpenChange={onCreateSQLDialogOpenChange}
          title={t('sidebar.overlays.createTableTitle')}
          description={createSQLDialog.title}
          className="max-w-4xl"
          footer={
            <>
              <Button variant="outline" onClick={() => onCreateSQLDialogOpenChange(false)}>
                {t('common.close')}
              </Button>
              <Button
                onClick={onCopyCreateSQL}
                disabled={createSQLDialog.loading || !createSQLDialog.sql}
              >
                {t('common.copySql')}
              </Button>
            </>
          }
        >
          {createSQLDialog.loading ? (
            <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
          ) : (
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-card p-3 text-xs">
              {createSQLDialog.sql}
            </pre>
          )}
        </Dialog>
      )}

      {exportDialog && (
        <ExportTableDialog
          open
          onOpenChange={onExportDialogOpenChange}
          connectionId={exportDialog.connectionId}
          database={exportDialog.database}
          table={exportDialog.table}
          availableScopes={['all']}
        />
      )}

      {exportDatabaseDialog && (
        <ExportDatabaseDialog
          open
          onOpenChange={onExportDatabaseDialogOpenChange}
          connectionId={exportDatabaseDialog.connectionId}
          database={exportDatabaseDialog.database}
        />
      )}

      {importDialog && (
        <ImportTableDialog
          open
          onOpenChange={onImportDialogOpenChange}
          connectionId={importDialog.connection.id}
          database={importDialog.database}
          table={importDialog.table}
          onImported={onImported}
        />
      )}
    </>
  )
}

function TableMenuItem({
  icon,
  label,
  onClick,
  danger = false
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent',
        danger && 'text-red-300 hover:bg-red-500/10'
      )}
      onClick={onClick}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  )
}