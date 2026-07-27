// The sidebar's single destructive-confirmation surface (blueprint §2.8).
//
// It replaces the two native `confirm()` calls this file's predecessor had
// (`Sidebar.tsx:579` copy table, `:850` delete connection) and unifies them with
// the truncate/drop dialog that already existed, so "the same operation differs
// by entry point" stops being true.
import { ConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { useI18n } from '@renderer/i18n'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import type { SidebarConfirmRequest } from './sidebar-types'
import { useSidebarActions } from './sidebar-actions'

function subjectOf(request: SidebarConfirmRequest): string {
  switch (request.kind) {
    case 'copy-table':
    case 'truncate-table':
    case 'drop-table':
      return `${request.database}.${request.table}`
    case 'drop-database':
      return request.database
    case 'delete-connection':
      return request.connection.name
  }
}

export function SidebarConfirmDialog() {
  const { t } = useI18n()
  const actions = useSidebarActions()
  const request = useSidebarStore((state) => state.pendingConfirm)
  const setPendingConfirm = useSidebarStore((state) => state.setPendingConfirm)

  const isRedis = request?.connection.engine === 'redis'
  const truncating = request?.kind === 'truncate-table'

  const title = (() => {
    if (!request) return ''
    switch (request.kind) {
      case 'copy-table':
        return t('sidebar.overlays.copyToCopy', { table: request.table })
      case 'truncate-table':
        return t('sidebar.overlays.truncateTable')
      case 'drop-table':
        return isRedis ? t('sidebar.overlays.deleteRedisKey') : t('sidebar.overlays.dropTable')
      case 'drop-database':
        return t('sidebar.overlays.dropDatabase')
      case 'delete-connection':
        return t('sidebar.overlays.deleteConnection')
    }
  })()

  const body = (() => {
    if (!request) return null
    switch (request.kind) {
      case 'copy-table':
        return t('sidebar.confirm.copyTable', {
          table: request.table,
          targetTable: request.targetTable
        })
      case 'truncate-table':
        return t('sidebar.confirm.truncateTable', {
          database: request.database,
          table: request.table
        })
      case 'drop-table':
        return isRedis
          ? t('redis.confirmDeleteKey', { key: request.table })
          : t('sidebar.confirm.dropTable', { database: request.database, table: request.table })
      case 'drop-database':
        return t('sidebar.confirm.dropDatabase', { database: request.database })
      case 'delete-connection':
        return t('sidebar.confirm.deleteConnection', { name: request.connection.name })
    }
  })()

  const confirmLabel = (() => {
    if (!request) return ''
    switch (request.kind) {
      case 'copy-table':
        return t('common.copy')
      case 'truncate-table':
        return t('sidebar.overlays.truncateResetIdentity')
      case 'drop-table':
        return isRedis ? t('sidebar.overlays.deleteRedisKey') : t('sidebar.overlays.dropTable')
      case 'drop-database':
        return t('sidebar.overlays.dropDatabaseAction')
      case 'delete-connection':
        return t('common.delete')
    }
  })()

  return (
    <ConfirmDialog
      open={request != null}
      onOpenChange={(open) => {
        if (!open) setPendingConfirm(null)
      }}
      tone={request?.kind === 'copy-table' ? 'default' : 'danger'}
      title={title}
      body={body}
      subject={request ? subjectOf(request) : undefined}
      cancelLabel={t('common.cancel')}
      confirmLabel={confirmLabel}
      // Truncate genuinely has two destructive outcomes; the primitive was
      // designed from this exact dialog.
      secondaryConfirm={
        truncating
          ? {
              label: t('sidebar.overlays.clearKeepIdentity'),
              onConfirm: async () => {
                await actions.runConfirmedAction(request, false)
              }
            }
          : undefined
      }
      requireTypedConfirmation={request?.kind === 'drop-database' ? request.database : undefined}
      typedConfirmationHint={t('sidebar.confirm.typeDatabaseToConfirm')}
      onConfirm={async () => {
        if (!request) return
        await actions.runConfirmedAction(request, true)
      }}
    />
  )
}
