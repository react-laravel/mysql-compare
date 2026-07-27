import type { SafeConnection } from '../../../shared/types'

export interface NodeState {
  expanded: boolean
  loading: boolean
  databases?: string[]
  tables: Record<string, string[]>
  tableCounts?: Record<string, number>
  expandedDbs: Set<string>
}

export interface TableMenuState {
  x: number
  y: number
  connection: SafeConnection
  database: string
  table: string
}

export interface DatabaseMenuState {
  x: number
  y: number
  connection: SafeConnection
  database: string
}

export interface DatabaseCredentialDialogState {
  connection: SafeConnection
  database: string
}

export interface ConnectionMenuState {
  x: number
  y: number
  connection: SafeConnection
}

export interface RenameDialogState {
  connection: SafeConnection
  database: string
  table: string
}

/**
 * Every destructive sidebar action funnels through one `ConfirmDialog`
 * (blueprint §2.8), so the tree row's `⋯`, the right-click menu and the command
 * palette cannot drift into three different confirmations — or into a native
 * `confirm()`, which is what copy-table and delete-connection used to do.
 */
export type SidebarConfirmRequest =
  | {
      kind: 'copy-table'
      connection: SafeConnection
      database: string
      table: string
      targetTable: string
    }
  | { kind: 'truncate-table'; connection: SafeConnection; database: string; table: string }
  | { kind: 'drop-table'; connection: SafeConnection; database: string; table: string }
  | { kind: 'drop-database'; connection: SafeConnection; database: string }
  | { kind: 'delete-connection'; connection: SafeConnection }

export interface CreateSQLDialogState {
  title: string
  sql: string
  loading: boolean
}

export interface ExportDialogState {
  connectionId: string
  database: string
  table: string
}

export interface ExportDatabaseDialogState {
  connectionId: string
  database: string
}

export interface ImportDialogState {
  connection: SafeConnection
  database: string
  table: string
}

/**
 * "Compare with…" from a table row (blueprint §2.4). It carries the *source*
 * endpoint; the dialog picks the target and opens the `table-compare` tab.
 */
export interface TableCompareTargetDialogState {
  connection: SafeConnection
  database: string
  table: string
}

export interface CreateRedisKeyDialogState {
  connection: SafeConnection
  database: string
}

export type CreateRedisKeyType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream'

export interface CreateRedisKeyPayload {
  key: string
  type: CreateRedisKeyType
  value?: string
  field?: string
  member?: string
  score?: number
  ttlSeconds?: number
  fields?: Record<string, string>
}

export interface StickyDatabaseContext {
  connectionName: string
  database: string
}

export interface DatabaseRowRefEntry {
  element: HTMLDivElement | null
  connectionName: string
  database: string
}
