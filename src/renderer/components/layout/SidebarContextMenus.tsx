// Right-click menus for the three tree object types.
//
// A thin wrapper: the items come from `sidebar-menus.ts`, which the row's
// persistent `⋯` renders too, and the destructive branches route into the one
// `SidebarConfirmDialog`. What used to be a 47-prop component is now three
// store reads.
import { ContextMenu } from '@renderer/components/ui/context-menu'
import { useI18n } from '@renderer/i18n'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useSidebarActions } from './sidebar-actions'
import {
  buildConnectionMenuItems,
  buildDatabaseMenuItems,
  buildTableMenuItems
} from './sidebar-menus'

export function SidebarContextMenus() {
  const { t } = useI18n()
  const actions = useSidebarActions()
  const connectionMenu = useSidebarStore((state) => state.connectionMenu)
  const databaseMenu = useSidebarStore((state) => state.databaseMenu)
  const tableMenu = useSidebarStore((state) => state.tableMenu)
  const setConnectionMenu = useSidebarStore((state) => state.setConnectionMenu)
  const setDatabaseMenu = useSidebarStore((state) => state.setDatabaseMenu)
  const setTableMenu = useSidebarStore((state) => state.setTableMenu)

  return (
    <>
      {connectionMenu ? (
        <ContextMenu
          at={connectionMenu}
          onClose={() => setConnectionMenu(null)}
          aria-label={connectionMenu.connection.name}
          items={buildConnectionMenuItems({ connection: connectionMenu.connection, t, actions })}
        />
      ) : null}

      {databaseMenu ? (
        <ContextMenu
          at={databaseMenu}
          onClose={() => setDatabaseMenu(null)}
          aria-label={databaseMenu.database}
          items={buildDatabaseMenuItems({
            connection: databaseMenu.connection,
            database: databaseMenu.database,
            t,
            actions
          })}
        />
      ) : null}

      {tableMenu ? (
        <ContextMenu
          at={tableMenu}
          onClose={() => setTableMenu(null)}
          aria-label={tableMenu.table}
          items={buildTableMenuItems({
            connection: tableMenu.connection,
            database: tableMenu.database,
            table: tableMenu.table,
            t,
            actions
          })}
        />
      ) : null}
    </>
  )
}
