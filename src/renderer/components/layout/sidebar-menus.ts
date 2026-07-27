// One menu builder per object type (blueprint chunk 6).
//
// The row's persistent `⋯` and the right-click `ContextMenu` render the *same*
// array, so they can never drift apart — which is what happened before, where a
// database row carried four hover-gated icons duplicating a context menu that
// also had items the icons did not.
import {
  CircleEllipsis,
  Copy,
  Download,
  Eraser,
  FileCode2,
  Folder,
  GitCompareArrows,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  SquareTerminal,
  Trash2,
  Unplug,
  Upload
} from 'lucide-react'
import type { MenuItem } from '@renderer/components/ui/dropdown-menu'
import type { useI18n } from '@renderer/i18n'
import type { SafeConnection } from '../../../shared/types'
import type { SidebarActions } from './sidebar-actions'

type Translate = ReturnType<typeof useI18n>['t']

interface MenuContext {
  t: Translate
  actions: SidebarActions
}

export function buildConnectionMenuItems({
  connection,
  t,
  actions
}: MenuContext & { connection: SafeConnection }): MenuItem[] {
  return [
    ...(connection.useSSH
      ? [
          {
            id: 'ssh-files',
            icon: Folder,
            label: t('sidebar.openSshFiles'),
            onSelect: () => actions.openSSHFiles(connection)
          } satisfies MenuItem,
          {
            id: 'ssh-terminal',
            icon: SquareTerminal,
            label: t('sidebar.openSshTerminal'),
            onSelect: () => actions.openSSHTerminal(connection)
          } satisfies MenuItem,
          { kind: 'separator', id: 'sep-ssh' } satisfies MenuItem
        ]
      : []),
    {
      id: 'edit',
      icon: Pencil,
      label: t('common.edit'),
      onSelect: () => actions.editConnection(connection)
    },
    ...(connection.useSSH
      ? [
          {
            id: 'create-with-ssh',
            icon: Plus,
            label: t('sidebar.overlays.createPostgresWithSsh'),
            onSelect: () => actions.createConnectionWithSSH(connection)
          } satisfies MenuItem
        ]
      : []),
    {
      id: 'close-connection',
      icon: Unplug,
      label: t('sidebar.overlays.closeDatabaseConnection'),
      onSelect: () => void actions.closeConnection(connection)
    },
    {
      id: 'delete-connection',
      icon: Trash2,
      label: t('sidebar.overlays.deleteConnection'),
      danger: true,
      onSelect: () => actions.requestDeleteConnection(connection)
    }
  ]
}

export function buildDatabaseMenuItems({
  connection,
  database,
  t,
  actions
}: MenuContext & { connection: SafeConnection; database: string }): MenuItem[] {
  const engineItems: MenuItem[] =
    connection.engine === 'redis'
      ? [
          {
            id: 'new-key',
            icon: FileCode2,
            label: t('sidebar.overlays.newRedisKey'),
            onSelect: () => actions.openCreateRedisKey(connection, database)
          }
        ]
      : [
          {
            id: 'sql-console',
            icon: FileCode2,
            label: t('sidebar.overlays.openSqlConsole'),
            onSelect: () => actions.openSQLConsole(connection, database)
          },
          ...(connection.engine === 'postgres'
            ? [
                {
                  id: 'credential',
                  icon: KeyRound,
                  label: t('sidebar.overlays.databaseCredential'),
                  onSelect: () => actions.openDatabaseCredential(connection, database)
                } satisfies MenuItem
              ]
            : []),
          {
            id: 'export',
            icon: Download,
            label: t('sidebar.overlays.exportDatabase'),
            onSelect: () => actions.openExportDatabase(connection, database)
          },
          {
            // The flow the app never had: a database row is a compare endpoint.
            id: 'compare',
            icon: GitCompareArrows,
            label: t('sidebar.overlays.compareDatabase'),
            onSelect: () => actions.compareDatabase(connection, database)
          }
        ]

  return [
    {
      id: 'details',
      icon: CircleEllipsis,
      label: t('sidebar.overlays.databaseDetails'),
      onSelect: () => actions.openDatabaseDetails(connection, database)
    },
    { kind: 'separator', id: 'sep-1' },
    ...engineItems,
    {
      id: 'refresh',
      icon: RefreshCw,
      label: t('common.refresh'),
      onSelect: () => void actions.refreshDatabase(connection, database)
    },
    ...(connection.engine === 'redis'
      ? []
      : [
          {
            // Drop database used to live only inside `DatabaseInfoView`'s
            // danger zone, three clicks from the object it destroys.
            id: 'drop-database',
            icon: Trash2,
            label: t('sidebar.overlays.dropDatabase'),
            danger: true,
            onSelect: () => actions.requestDropDatabase(connection, database)
          } satisfies MenuItem
        ])
  ]
}

export function buildTableMenuItems({
  connection,
  database,
  table,
  t,
  actions
}: MenuContext & { connection: SafeConnection; database: string; table: string }): MenuItem[] {
  const details: MenuItem[] = [
    {
      id: 'details',
      icon: CircleEllipsis,
      label: t('sidebar.overlays.tableDetails'),
      onSelect: () => actions.openTableDetails(connection, database, table)
    },
    { kind: 'separator', id: 'sep-1' }
  ]

  if (connection.engine === 'redis') {
    return [
      ...details,
      {
        id: 'rename',
        icon: Pencil,
        label: t('sidebar.overlays.renameRedisKey'),
        onSelect: () => actions.startRename(connection, database, table)
      },
      {
        id: 'drop',
        icon: Trash2,
        label: t('sidebar.overlays.deleteRedisKey'),
        danger: true,
        onSelect: () => actions.requestDropTable(connection, database, table)
      }
    ]
  }

  return [
    ...details,
    {
      id: 'rename',
      icon: Pencil,
      label: t('sidebar.overlays.renameTable'),
      onSelect: () => actions.startRename(connection, database, table)
    },
    {
      id: 'copy',
      icon: Copy,
      label: t('sidebar.overlays.copyToCopy', { table }),
      onSelect: () => actions.requestCopyTable(connection, database, table)
    },
    {
      // Blueprint §2.4: a table row is a compare endpoint too. This is the
      // entrance that made `TableCompareView` reachable in one step.
      id: 'compare-with',
      icon: GitCompareArrows,
      label: t('sidebar.overlays.compareTableWith'),
      onSelect: () => actions.compareTableWith(connection, database, table)
    },
    {
      id: 'create-sql',
      icon: FileCode2,
      label: t('sidebar.overlays.showCreateTable'),
      onSelect: () => void actions.showCreateSQL(connection, database, table)
    },
    {
      id: 'export',
      icon: Download,
      label: t('sidebar.overlays.exportEllipsis'),
      onSelect: () => actions.openExportTable(connection, database, table)
    },
    {
      id: 'import',
      icon: Upload,
      label: t('sidebar.overlays.importEllipsis'),
      onSelect: () => actions.openImportTable(connection, database, table)
    },
    {
      id: 'truncate',
      icon: Eraser,
      label: t('sidebar.overlays.truncateTable'),
      danger: true,
      onSelect: () => actions.requestTruncateTable(connection, database, table)
    },
    {
      id: 'drop',
      icon: Trash2,
      label: t('sidebar.overlays.dropTable'),
      danger: true,
      onSelect: () => actions.requestDropTable(connection, database, table)
    }
  ]
}
