import type { ColumnInfo, SqlDbEngine } from '../../../shared/types'

interface BuildRowInsertSQLArgs {
  engine: SqlDbEngine
  database: string
  table: string
  columns: ColumnInfo[]
  row: Record<string, unknown>
  includeId: boolean
}

export function buildRowInsertSQL({
  engine,
  database,
  table,
  columns,
  row,
  includeId
}: BuildRowInsertSQLArgs): string {
  const insertColumns = includeId ? columns : withoutGeneratedId(columns)
  if (insertColumns.length === 0) {
    throw new Error('No columns available for INSERT')
  }

  const quoteIdent = engine === 'mysql' ? quoteMySQLIdent : quotePostgresIdent
  const target =
    engine === 'mysql'
      ? `${quoteIdent(database)}.${quoteIdent(table)}`
      : `${quoteIdent('public')}.${quoteIdent(table)}`
  const columnSQL = insertColumns.map((column) => quoteIdent(column.name)).join(', ')
  const valueSQL = insertColumns
    .map((column) => formatSQLLiteral(row[column.name], engine))
    .join(', ')

  return `INSERT INTO ${target} (${columnSQL}) VALUES\n  (${valueSQL});`
}

function withoutGeneratedId(columns: ColumnInfo[]): ColumnInfo[] {
  const autoIncrementNames = new Set(
    columns.filter((column) => column.isAutoIncrement).map((column) => column.name)
  )

  if (autoIncrementNames.size > 0) {
    return columns.filter((column) => !autoIncrementNames.has(column.name))
  }

  return columns.filter((column) => column.name.toLowerCase() !== 'id')
}

function quoteMySQLIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

function quotePostgresIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function formatSQLLiteral(value: unknown, engine: SqlDbEngine): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') {
    return engine === 'mysql' ? (value ? '1' : '0') : value ? 'TRUE' : 'FALSE'
  }
  if (value instanceof Date) {
    const formatted =
      engine === 'mysql' ? value.toISOString().slice(0, 19).replace('T', ' ') : value.toISOString()
    return `'${formatted}'`
  }

  const bufferHex = getBufferHex(value)
  if (bufferHex !== null) {
    return engine === 'mysql' ? `0x${bufferHex}` : `'\\x${bufferHex}'`
  }

  const text =
    typeof value === 'object' ? (JSON.stringify(value) ?? String(value)) : String(value)
  const escaped =
    engine === 'mysql'
      ? text.replace(/\\/g, '\\\\').replace(/'/g, "''")
      : text.replace(/'/g, "''")
  return `'${escaped}'`
}

function getBufferHex(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { type?: unknown; hex?: unknown; data?: unknown }
  if (candidate.type !== 'Buffer') return null
  if (typeof candidate.hex === 'string') return candidate.hex
  if (Array.isArray(candidate.data)) {
    return candidate.data
      .map((byte) => Number(byte).toString(16).padStart(2, '0'))
      .join('')
  }
  return null
}
