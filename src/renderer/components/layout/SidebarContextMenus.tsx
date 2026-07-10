import type { ReactNode } from 'react'
import {
  CircleEllipsis,
  Copy,
  Download,
  Eraser,
  FileCode2,
  KeyRound,
  Pencil,
  RefreshCw,
  Trash2,
  Unplug,
  Upload
} from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import { cn } from '@renderer/lib/utils'
import type { SafeConnection } from '../../../shared/types'
import type { ConnectionMenuState, DatabaseMenuState, TableMenuState } from './sidebar-types'

interface SidebarContextMenusProps {
  connectionMenu: ConnectionMenuState | null
  onCloseConnectionMenu: () => void
  onCloseDatabaseConnection: (menu: ConnectionMenuState) => void | Promise<void>
  onEditConnection: (connection: SafeConnection) => void
  tableMenu: TableMenuState | null
  onCloseTableMenu: () => void
  onOpenTableDetails: (menu: TableMenuState) => void
  onRenameTable: (menu: TableMenuState) => void
  onCopyTable: (menu: TableMenuState) => void | Promise<void>
  onShowCreateSQL: (menu: TableMenuState) => void | Promise<void>
  onExportTable: (menu: TableMenuState) => void
  onImportTable: (menu: TableMenuState) => void
  onTruncateTable: (menu: TableMenuState) => void | Promise<void>
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
          <MenuItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            label={t('common.edit')}
            onClick={() => onEditConnection(connectionMenu.connection)}
          />
        </ContextMenu>
      )}

      {tableMenu && (
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
                onClick={() => onDropTable(tableMenu)}
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
                onClick={() => onTruncateTable(tableMenu)}
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
  return (
    <div className="fixed inset-0 z-[80]" onClick={onClose}>
      <div
        className="absolute w-56 rounded-md border border-border bg-card p-1 shadow-xl"
        style={{ left: x, top: y }}
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
        danger && 'text-red-300 hover:bg-red-500/10'
      )}
      onClick={onClick}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
