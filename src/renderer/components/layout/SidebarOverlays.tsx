import { ConnectionDialog } from '@renderer/components/connection/ConnectionDialog'
import { ExportDatabaseDialog } from '@renderer/components/table-view/ExportDatabaseDialog'
import { ExportTableDialog } from '@renderer/components/table-view/ExportTableDialog'
import { ImportTableDialog } from '@renderer/components/table-view/ImportTableDialog'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { useI18n } from '@renderer/i18n'
import type { SafeConnection } from '../../../shared/types'
import { RedisKeyCreateDialog } from './RedisKeyCreateDialog'
import { SidebarContextMenus } from './SidebarContextMenus'
import { SidebarDatabaseCredentialDialog } from './SidebarDatabaseCredentialDialog'
import type {
  CreateSQLDialogState,
  CreateRedisKeyDialogState,
  CreateRedisKeyPayload,
  ConnectionMenuState,
  DatabaseCredentialDialogState,
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
  connectionMenu: ConnectionMenuState | null
  onCloseConnectionMenu: () => void
  onCloseDatabaseConnection: (menu: ConnectionMenuState) => void | Promise<void>
  onEditConnection: (connection: SafeConnection) => void
  tableMenu: TableMenuState | null
  onCloseTableMenu: () => void
  databaseMenu: DatabaseMenuState | null
  onCloseDatabaseMenu: () => void
  onOpenDatabaseDetails: (menu: DatabaseMenuState) => void
  onOpenDatabaseSQLConsole: (menu: DatabaseMenuState) => void
  onOpenDatabaseCredentialDialog: (menu: DatabaseMenuState) => void
  onCreateRedisKey: (menu: DatabaseMenuState) => void
  onExportDatabase: (menu: DatabaseMenuState) => void
  onRefreshDatabase: (menu: DatabaseMenuState) => void | Promise<void>
  onOpenTableDetails: (menu: TableMenuState) => void
  onRenameTable: (menu: TableMenuState) => void
  onCopyTable: (menu: TableMenuState) => void | Promise<void>
  onShowCreateSQL: (menu: TableMenuState) => void | Promise<void>
  onExportTable: (menu: TableMenuState) => void
  onImportTable: (menu: TableMenuState) => void
  onTruncateTable: (menu: TableMenuState) => void | Promise<void>
  onDropTable: (menu: TableMenuState) => void | Promise<void>
  renameDialog: RenameDialogState | null
  renameDraft: string
  actionBusy: boolean
  onRenameDraftChange: (value: string) => void
  onRenameDialogOpenChange: (open: boolean) => void
  onSubmitRename: () => void | Promise<void>
  createSQLDialog: CreateSQLDialogState | null
  onCreateSQLDialogOpenChange: (open: boolean) => void
  onCopyCreateSQL: () => void
  createRedisKeyDialog: CreateRedisKeyDialogState | null
  onCreateRedisKeyDialogOpenChange: (open: boolean) => void
  onSubmitCreateRedisKey: (payload: CreateRedisKeyPayload) => void | Promise<void>
  exportDialog: ExportDialogState | null
  onExportDialogOpenChange: (open: boolean) => void
  exportDatabaseDialog: ExportDatabaseDialogState | null
  onExportDatabaseDialogOpenChange: (open: boolean) => void
  importDialog: ImportDialogState | null
  onImportDialogOpenChange: (open: boolean) => void
  onImported: () => void | Promise<void>
  databaseCredentialDialog: DatabaseCredentialDialogState | null
  databaseCredentialUsername: string
  databaseCredentialPassword: string
  databaseCredentialUseDefault: boolean
  databaseCredentialFeedback: { level: 'success' | 'error'; message: string } | null
  onDatabaseCredentialUsernameChange: (value: string) => void
  onDatabaseCredentialPasswordChange: (value: string) => void
  onDatabaseCredentialUseDefaultChange: (value: boolean) => void
  onDatabaseCredentialDialogOpenChange: (open: boolean) => void
  onTestDatabaseCredential: () => void | Promise<void>
  onSubmitDatabaseCredential: () => void | Promise<void>
}

export function SidebarOverlays({
  creating,
  editing,
  onConnectionDialogOpenChange,
  onConnectionSaved,
  onDeleteConnection,
  connectionMenu,
  onCloseConnectionMenu,
  onCloseDatabaseConnection,
  onEditConnection,
  tableMenu,
  onCloseTableMenu,
  databaseMenu,
  onCloseDatabaseMenu,
  onOpenDatabaseDetails,
  onOpenDatabaseSQLConsole,
  onOpenDatabaseCredentialDialog,
  onCreateRedisKey,
  onExportDatabase,
  onRefreshDatabase,
  onOpenTableDetails,
  onRenameTable,
  onCopyTable,
  onShowCreateSQL,
  onExportTable,
  onImportTable,
  onTruncateTable,
  onDropTable,
  renameDialog,
  renameDraft,
  actionBusy,
  onRenameDraftChange,
  onRenameDialogOpenChange,
  onSubmitRename,
  createSQLDialog,
  onCreateSQLDialogOpenChange,
  onCopyCreateSQL,
  createRedisKeyDialog,
  onCreateRedisKeyDialogOpenChange,
  onSubmitCreateRedisKey,
  exportDialog,
  onExportDialogOpenChange,
  exportDatabaseDialog,
  onExportDatabaseDialogOpenChange,
  importDialog,
  onImportDialogOpenChange,
  onImported,
  databaseCredentialDialog,
  databaseCredentialUsername,
  databaseCredentialPassword,
  databaseCredentialUseDefault,
  databaseCredentialFeedback,
  onDatabaseCredentialUsernameChange,
  onDatabaseCredentialPasswordChange,
  onDatabaseCredentialUseDefaultChange,
  onDatabaseCredentialDialogOpenChange,
  onTestDatabaseCredential,
  onSubmitDatabaseCredential
}: SidebarOverlaysProps) {
  const { t } = useI18n()
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

      <SidebarContextMenus
        connectionMenu={connectionMenu}
        onCloseConnectionMenu={onCloseConnectionMenu}
        onCloseDatabaseConnection={onCloseDatabaseConnection}
        onEditConnection={onEditConnection}
        tableMenu={tableMenu}
        onCloseTableMenu={onCloseTableMenu}
        onOpenTableDetails={onOpenTableDetails}
        onRenameTable={onRenameTable}
        onCopyTable={onCopyTable}
        onShowCreateSQL={onShowCreateSQL}
        onExportTable={onExportTable}
        onImportTable={onImportTable}
        onTruncateTable={onTruncateTable}
        onDropTable={onDropTable}
        databaseMenu={databaseMenu}
        onCloseDatabaseMenu={onCloseDatabaseMenu}
        onOpenDatabaseDetails={onOpenDatabaseDetails}
        onOpenDatabaseSQLConsole={onOpenDatabaseSQLConsole}
        onOpenDatabaseCredentialDialog={onOpenDatabaseCredentialDialog}
        onCreateRedisKey={onCreateRedisKey}
        onExportDatabase={onExportDatabase}
        onRefreshDatabase={onRefreshDatabase}
      />

      {databaseCredentialDialog && (
        <SidebarDatabaseCredentialDialog
          dialog={databaseCredentialDialog}
          username={databaseCredentialUsername}
          password={databaseCredentialPassword}
          useDefault={databaseCredentialUseDefault}
          feedback={databaseCredentialFeedback}
          busy={actionBusy}
          onUsernameChange={onDatabaseCredentialUsernameChange}
          onPasswordChange={onDatabaseCredentialPasswordChange}
          onUseDefaultChange={onDatabaseCredentialUseDefaultChange}
          onOpenChange={onDatabaseCredentialDialogOpenChange}
          onTest={onTestDatabaseCredential}
          onSubmit={onSubmitDatabaseCredential}
        />
      )}

      {renameDialog && (
        <Dialog
          open
          onOpenChange={onRenameDialogOpenChange}
          title={renameDialog.connection.engine === 'redis'
            ? t('sidebar.overlays.renameRedisKey')
            : t('sidebar.overlays.renameTable')}
          description={renameDialog.connection.engine === 'redis'
            ? `${renameDialog.database} / ${renameDialog.table}`
            : t('sidebar.overlays.renameDescription', {
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
            <Label className="block">
              {renameDialog.connection.engine === 'redis' ? t('redis.keyName') : t('sidebar.overlays.newTableName')}
            </Label>
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

      {createRedisKeyDialog && (
        <RedisKeyCreateDialog
          dialog={createRedisKeyDialog}
          busy={actionBusy}
          onOpenChange={onCreateRedisKeyDialogOpenChange}
          onSubmit={onSubmitCreateRedisKey}
        />
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
