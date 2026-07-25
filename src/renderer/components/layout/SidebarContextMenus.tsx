import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  CircleEllipsis,
  Copy,
  Download,
  Eraser,
  FileCode2,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
  Upload
} from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import type { SafeConnection } from '../../../shared/types'
import type { ConnectionMenuState, DatabaseMenuState, TableMenuState } from './sidebar-types'

interface SidebarContextMenusProps {
  connectionMenu: ConnectionMenuState | null
  onCloseConnectionMenu: () => void
  onCloseDatabaseConnection: (menu: ConnectionMenuState) => void | Promise<void>
  onEditConnection: (connection: SafeConnection) => void
  onCreateWithSSH: (connection: SafeConnection) => void
  tableMenu: TableMenuState | null
  onCloseTableMenu: () => void
  onOpenTableDetails: (menu: TableMenuState) => void
  onRenameTable: (menu: TableMenuState) => void
  onCopyTable: (menu: TableMenuState) => void | Promise<void>
  onShowCreateSQL: (menu: TableMenuState) => void | Promise<void>
  onExportTable: (menu: TableMenuState) => void
  onImportTable: (menu: TableMenuState) => void
  onTruncateTable: (menu: TableMenuState, resetIdentity: boolean) => void | Promise<void>
  onDropTable: (menu: TableMenuState) => void | Promise<void>
  databaseMenu: DatabaseMenuState | null
  onCloseDatabaseMenu: () => void
  onOpenDatabaseDetails: (menu: DatabaseMenuState) => void
  onOpenDatabaseSQLConsole: (menu: DatabaseMenuState) => void
  onOpenDatabaseCredentialDialog: (menu: DatabaseMenuState) => void
  onCreateRedisKey: (menu: DatabaseMenuState) => void
  onExportDatabase: (menu: DatabaseMenuState) => void
  onRefreshDatabase: (menu: DatabaseMenuState) => void | Promise<void>
}

export function SidebarContextMenus({
  connectionMenu,
  onCloseConnectionMenu,
  onCloseDatabaseConnection,
  onEditConnection,
  onCreateWithSSH,
  tableMenu,
  onCloseTableMenu,
  onOpenTableDetails,
  onRenameTable,
  onCopyTable,
  onShowCreateSQL,
  onExportTable,
  onImportTable,
  onTruncateTable,
  onDropTable,
  databaseMenu,
  onCloseDatabaseMenu,
  onOpenDatabaseDetails,
  onOpenDatabaseSQLConsole,
  onOpenDatabaseCredentialDialog,
  onCreateRedisKey,
  onExportDatabase,
  onRefreshDatabase
}: SidebarContextMenusProps) {
  const { t } = useI18n()
  const [pendingDangerAction, setPendingDangerAction] = useState<{
    kind: 'truncate' | 'drop'
    menu: TableMenuState
  } | null>(null)
  const [confirmingAction, setConfirmingAction] = useState(false)

  const requestDangerAction = (kind: 'truncate' | 'drop', menu: TableMenuState) => {
    onCloseTableMenu()
    setPendingDangerAction({ kind, menu })
  }

  const confirmDangerAction = async (resetIdentity = true) => {
    if (!pendingDangerAction || confirmingAction) return
    setConfirmingAction(true)
    try {
      if (pendingDangerAction.kind === 'truncate') {
        await onTruncateTable(pendingDangerAction.menu, resetIdentity)
      } else {
        await onDropTable(pendingDangerAction.menu)
      }
      setPendingDangerAction(null)
    } finally {
      setConfirmingAction(false)
    }
  }

  return (
    <>
      {connectionMenu && (
        <ContextMenu x={connectionMenu.x} y={connectionMenu.y} onClose={onCloseConnectionMenu}>
          <MenuItem
            icon={<Unplug className="h-3.5 w-3.5" />}
            label={t('sidebar.overlays.closeDatabaseConnection')}
            onClick={() => onCloseDatabaseConnection(connectionMenu)}
          />
          <MenuDivider />
          {connectionMenu.connection.useSSH && (
            <MenuItem
              icon={<Plus className="h-3.5 w-3.5" />}
              label={t('sidebar.overlays.createPostgresWithSsh')}
              onClick={() => onCreateWithSSH(connectionMenu.connection)}
            />
          )}
          <MenuItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            label={t('common.edit')}
            onClick={() => onEditConnection(connectionMenu.connection)}
          />
        </ContextMenu>
      )}

      {tableMenu && !pendingDangerAction && (
        <ContextMenu x={tableMenu.x} y={tableMenu.y} onClose={onCloseTableMenu}>
          <MenuItem
            icon={<CircleEllipsis className="h-3.5 w-3.5" />}
            label={t('sidebar.overlays.tableDetails')}
            onClick={() => onOpenTableDetails(tableMenu)}
          />
          <MenuDivider />
          {tableMenu.connection.engine === 'redis' ? (
            <>
              <MenuItem
                icon={<Pencil className="h-3.5 w-3.5" />}
                label={t('sidebar.overlays.renameRedisKey')}
                onClick={() => onRenameTable(tableMenu)}
              />
              <MenuItem
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label={t('sidebar.overlays.deleteRedisKey')}
                onClick={() => requestDangerAction('drop', tableMenu)}
                danger
              />
            </>
          ) : (
            <>
              <MenuItem
                icon={<Pencil className="h-3.5 w-3.5" />}
                label={t('sidebar.overlays.renameTable')}
                onClick={() => onRenameTable(tableMenu)}
              />
              <MenuItem
                icon={<Copy className="h-3.5 w-3.5" />}
                label={t('sidebar.overlays.copyToCopy', { table: tableMenu.table })}
                onClick={() => onCopyTable(tableMenu)}
              />
              <MenuItem
                icon={<FileCode2 className="h-3.5 w-3.5" />}
                label={t('sidebar.overlays.showCreateTable')}
                onClick={() => onShowCreateSQL(tableMenu)}
              />
              <MenuItem
                icon={<Download className="h-3.5 w-3.5" />}
                label={t('sidebar.overlays.exportEllipsis')}
                onClick={() => onExportTable(tableMenu)}
              />
              <MenuItem
                icon={<Upload className="h-3.5 w-3.5" />}
                label={t('sidebar.overlays.importEllipsis')}
                onClick={() => onImportTable(tableMenu)}
              />
              <MenuDivider />
              <MenuItem
                icon={<Eraser className="h-3.5 w-3.5" />}
                label={t('sidebar.overlays.truncateTable')}
                onClick={() => requestDangerAction('truncate', tableMenu)}
                danger
              />
              <MenuItem
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label={t('sidebar.overlays.dropTable')}
                onClick={() => requestDangerAction('drop', tableMenu)}
                danger
              />
            </>
          )}
        </ContextMenu>
      )}

      {databaseMenu && (
        <ContextMenu x={databaseMenu.x} y={databaseMenu.y} onClose={onCloseDatabaseMenu}>
          <MenuItem
            icon={<CircleEllipsis className="h-3.5 w-3.5" />}
            label={t('sidebar.overlays.databaseDetails')}
            onClick={() => onOpenDatabaseDetails(databaseMenu)}
          />
          <MenuDivider />
          {databaseMenu.connection.engine === 'redis' ? (
            <MenuItem
              icon={<FileCode2 className="h-3.5 w-3.5" />}
              label={t('sidebar.overlays.newRedisKey')}
              onClick={() => onCreateRedisKey(databaseMenu)}
            />
          ) : (
            <>
              <MenuItem
                icon={<FileCode2 className="h-3.5 w-3.5" />}
                label={t('sidebar.overlays.openSqlConsole')}
                onClick={() => onOpenDatabaseSQLConsole(databaseMenu)}
              />
              {databaseMenu.connection.engine === 'postgres' && (
                <MenuItem
                  icon={<KeyRound className="h-3.5 w-3.5" />}
                  label={t('sidebar.overlays.databaseCredential')}
                  onClick={() => onOpenDatabaseCredentialDialog(databaseMenu)}
                />
              )}
              <MenuItem
                icon={<Download className="h-3.5 w-3.5" />}
                label={t('sidebar.overlays.exportDatabase')}
                onClick={() => onExportDatabase(databaseMenu)}
              />
            </>
          )}
          <MenuItem
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            label={t('common.refresh')}
            onClick={() => onRefreshDatabase(databaseMenu)}
          />
        </ContextMenu>
      )}

      {pendingDangerAction && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !confirmingAction) setPendingDangerAction(null)
          }}
          title={
            pendingDangerAction.menu.connection.engine === 'redis'
              ? t('sidebar.overlays.deleteRedisKey')
              : pendingDangerAction.kind === 'truncate'
                ? t('sidebar.overlays.truncateTable')
                : t('sidebar.overlays.dropTable')
          }
          description={
            pendingDangerAction.menu.connection.engine === 'redis'
              ? t('redis.confirmDeleteKey', { key: pendingDangerAction.menu.table })
              : pendingDangerAction.kind === 'truncate'
                ? t('sidebar.confirm.truncateTable', {
                    database: pendingDangerAction.menu.database,
                    table: pendingDangerAction.menu.table
                  })
                : t('sidebar.confirm.dropTable', {
                    database: pendingDangerAction.menu.database,
                    table: pendingDangerAction.menu.table
                  })
          }
          className="max-w-md"
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setPendingDangerAction(null)}
                disabled={confirmingAction}
              >
                {t('common.cancel')}
              </Button>
              {pendingDangerAction.kind === 'truncate' ? (
                <>
                  <Button
                    variant="destructive"
                    onClick={() => confirmDangerAction(false)}
                    disabled={confirmingAction}
                  >
                    {t('sidebar.overlays.clearKeepIdentity')}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => confirmDangerAction(true)}
                    disabled={confirmingAction}
                  >
                    {t('sidebar.overlays.truncateResetIdentity')}
                  </Button>
                </>
              ) : (
                <Button
                  variant="destructive"
                  onClick={() => confirmDangerAction()}
                  disabled={confirmingAction}
                >
                  {pendingDangerAction.menu.connection.engine === 'redis'
                    ? t('sidebar.overlays.deleteRedisKey')
                    : t('sidebar.overlays.dropTable')}
                </Button>
              )}
            </>
          }
        >
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive dark:text-red-300">
            {pendingDangerAction.menu.database}.{pendingDangerAction.menu.table}
          </div>
        </Dialog>
      )}
    </>
  )
}

function ContextMenu({
  x,
  y,
  onClose,
  children
}: {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ x, y })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const viewportPadding = 8
    const width = menu.offsetWidth
    const height = menu.offsetHeight
    const nextX = Math.max(
      viewportPadding,
      Math.min(x, window.innerWidth - width - viewportPadding)
    )
    const nextY = Math.max(
      viewportPadding,
      Math.min(y, window.innerHeight - height - viewportPadding)
    )
    setPosition((current) =>
      current.x === nextX && current.y === nextY ? current : { x: nextX, y: nextY }
    )
  }, [x, y])

  return (
    <div className="fixed inset-0 z-[80]" onClick={onClose}>
      <div
        ref={menuRef}
        className="absolute w-56 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-xl"
        style={{
          left: position.x,
          top: position.y,
          maxHeight: 'calc(100vh - 16px)'
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function MenuDivider() {
  return <div className="my-1 h-px bg-border" />
}

function MenuItem({
  icon,
  label,
  onClick,
  danger = false
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent',
        danger && 'text-red-700 hover:bg-red-500/10 dark:text-red-300'
      )}
      onClick={onClick}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
