// Every floating surface the sidebar owns.
//
// This component used to take a 60-line, 43-prop interface whose only job was
// to relay `Sidebar.tsx`'s local state back down. All of that state lives in
// `sidebar-store` now, so the props are gone and each dialog reads exactly what
// it needs.
import { ConnectionDialog } from '@renderer/components/connection/ConnectionDialog'
import { ExportDatabaseDialog } from '@renderer/components/table-view/ExportDatabaseDialog'
import { ExportTableDialog } from '@renderer/components/table-view/ExportTableDialog'
import { ImportTableDialog } from '@renderer/components/table-view/ImportTableDialog'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Spinner } from '@renderer/components/ui/spinner'
import { useI18n } from '@renderer/i18n'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { TableCompareTargetDialog } from '@renderer/components/diff/TableCompareTargetDialog'
import { RedisKeyCreateDialog } from './RedisKeyCreateDialog'
import { SidebarConfirmDialog } from './SidebarConfirmDialog'
import { SidebarContextMenus } from './SidebarContextMenus'
import { SidebarDatabaseCredentialDialog } from './SidebarDatabaseCredentialDialog'
import { useSidebarActions } from './sidebar-actions'

export function SidebarOverlays() {
  const { t } = useI18n()
  const actions = useSidebarActions()
  const refreshConnections = useConnectionStore((state) => state.refresh)

  const creating = useSidebarStore((state) => state.creating)
  const editing = useSidebarStore((state) => state.editing)
  const sshSource = useSidebarStore((state) => state.sshSource)
  const setCreating = useSidebarStore((state) => state.setCreating)
  const setEditing = useSidebarStore((state) => state.setEditing)
  const setSSHSource = useSidebarStore((state) => state.setSSHSource)

  const actionBusy = useSidebarStore((state) => state.actionBusy)
  const createSQLDialog = useSidebarStore((state) => state.createSQLDialog)
  const setCreateSQLDialog = useSidebarStore((state) => state.setCreateSQLDialog)
  const createRedisKeyDialog = useSidebarStore((state) => state.createRedisKeyDialog)
  const setCreateRedisKeyDialog = useSidebarStore((state) => state.setCreateRedisKeyDialog)
  const exportDialog = useSidebarStore((state) => state.exportDialog)
  const setExportDialog = useSidebarStore((state) => state.setExportDialog)
  const exportDatabaseDialog = useSidebarStore((state) => state.exportDatabaseDialog)
  const setExportDatabaseDialog = useSidebarStore((state) => state.setExportDatabaseDialog)
  const importDialog = useSidebarStore((state) => state.importDialog)
  const setImportDialog = useSidebarStore((state) => state.setImportDialog)
  const databaseCredentialDialog = useSidebarStore((state) => state.databaseCredentialDialog)

  return (
    <>
      {creating || editing || sshSource ? (
        <ConnectionDialog
          open
          connection={editing}
          sshSource={sshSource}
          onOpenChange={(open) => {
            if (open) return
            setCreating(false)
            setEditing(null)
            setSSHSource(null)
          }}
          onSaved={refreshConnections}
        />
      ) : null}

      <SidebarContextMenus />
      <SidebarConfirmDialog />
      <TableCompareTargetDialog />

      {databaseCredentialDialog ? <SidebarDatabaseCredentialDialog /> : null}

      {createSQLDialog ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setCreateSQLDialog(null)
          }}
          title={t('sidebar.overlays.createTableTitle')}
          description={createSQLDialog.title}
          size="xl"
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreateSQLDialog(null)}>
                {t('common.close')}
              </Button>
              <Button
                variant="primary"
                onClick={actions.copyCreateSQL}
                disabled={createSQLDialog.loading || !createSQLDialog.sql}
              >
                {t('common.copySql')}
              </Button>
            </>
          }
        >
          {createSQLDialog.loading ? (
            <Spinner label={t('common.loading')} />
          ) : (
            <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-inset p-3 font-mono text-xs whitespace-pre-wrap">
              {createSQLDialog.sql}
            </pre>
          )}
        </Dialog>
      ) : null}

      {createRedisKeyDialog ? (
        <RedisKeyCreateDialog
          dialog={createRedisKeyDialog}
          busy={actionBusy}
          onOpenChange={(open) => {
            if (!open && !actionBusy) setCreateRedisKeyDialog(null)
          }}
          onSubmit={actions.createRedisKey}
        />
      ) : null}

      {exportDialog ? (
        <ExportTableDialog
          open
          onOpenChange={(open) => {
            if (!open) setExportDialog(null)
          }}
          connectionId={exportDialog.connectionId}
          database={exportDialog.database}
          table={exportDialog.table}
          availableScopes={['all']}
        />
      ) : null}

      {exportDatabaseDialog ? (
        <ExportDatabaseDialog
          open
          onOpenChange={(open) => {
            if (!open) setExportDatabaseDialog(null)
          }}
          connectionId={exportDatabaseDialog.connectionId}
          database={exportDatabaseDialog.database}
        />
      ) : null}

      {importDialog ? (
        <ImportTableDialog
          open
          onOpenChange={(open) => {
            if (!open) setImportDialog(null)
          }}
          connectionId={importDialog.connection.id}
          database={importDialog.database}
          table={importDialog.table}
          onImported={() => actions.refreshDatabase(importDialog.connection, importDialog.database)}
        />
      ) : null}
    </>
  )
}
