// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'
import { useToastStore } from '@renderer/store/toast-store'
import type { SafeConnection } from '../../../shared/types'
import { tableKey } from '../../../shared/table-reference'
import { createSidebarActions } from './sidebar-actions'

const { renameTable, listTables, listSchemas } = vi.hoisted(() => ({
  renameTable: vi.fn(), listTables: vi.fn(), listSchemas: vi.fn()
}))
vi.mock('@renderer/lib/api', () => ({
  api: { db: { renameTable, listTables, listSchemas } },
  unwrap: async <T>(value: Promise<T> | T): Promise<T> => await value
}))

afterEach(() => {
  useToastStore.getState().clear()
  vi.restoreAllMocks()
})

it('keeps scoped table keys through rename API and tabs while showing a readable toast', async () => {
  const connection: SafeConnection = {
    id: 'pg', name: 'Server', engine: 'postgres', username: 'tester', database: 'app',
    host: 'localhost', port: 5432, useSSH: false, createdAt: 1, updatedAt: 1,
    hasPassword: true, hasSSHPassword: false, hasSSHPrivateKey: false
  }
  const oldTable = tableKey('sales.v2', 'users')
  const newTable = tableKey('sales.v2', 'customers')
  renameTable.mockResolvedValue({ table: newTable })
  listSchemas.mockResolvedValue(['sales.v2'])
  listTables.mockResolvedValue([newTable])
  useSidebarStore.setState({ actionBusy: false, inlineRename: null, nodes: {
    pg: {
      expanded: true, loading: false, databases: ['app'], tables: { app: [oldTable] },
      expandedDbs: new Set(['app']), activeSchemas: { app: 'sales.v2' }
    }
  } })
  useUIStore.setState({ workspaceTabs: [], activeTabId: null, rightView: { kind: 'empty' } })
  const controller = createSidebarActions((key, vars) => `${key}: ${vars?.table ?? ''}`)
  controller.selectTable(connection, 'app', oldTable)
  controller.startRename(connection, 'app', oldTable)
  await controller.submitRename('customers')

  expect(renameTable).toHaveBeenCalledWith({
    connectionId: 'pg', database: 'app', table: oldTable, newTable
  })
  expect(useUIStore.getState().workspaceTabs[0]?.view).toMatchObject({ table: newTable })
  expect(useToastStore.getState().toasts.at(-1)?.title).toBe(
    'sidebar.toast.renamedTo: sales.v2.customers'
  )
})
