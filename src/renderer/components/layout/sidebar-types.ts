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

export interface RenameDialogState {
  connection: SafeConnection
  database: string
  table: string
}

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