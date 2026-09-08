import type { ColumnInfo, SyncRequest } from '../../../shared/types'

export interface CompareColumn {
  name: string
  source?: ColumnInfo
  target?: ColumnInfo
}

export interface BuildOverwriteTargetSyncRequestOptions {
  taskId?: string
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  table: string
}

export function buildCompareColumns(
  sourceColumns: ColumnInfo[],
  targetColumns: ColumnInfo[]
): CompareColumn[] {
  const targetByName = new Map(targetColumns.map((column) => [column.name, column]))
  const seen = new Set<string>()
  const columns: CompareColumn[] = []

  for (const source of sourceColumns) {
    seen.add(source.name)
    columns.push({
      name: source.name,
      source,
      target: targetByName.get(source.name)
    })
  }

  for (const target of targetColumns) {
    if (seen.has(target.name)) continue
    columns.push({
      name: target.name,
      target
    })
  }

  return columns
}

export function buildRowKey(
  row: Record<string, unknown>,
  keyColumns: string[]
): string | null {
  if (keyColumns.length === 0 || keyColumns.some((column) => row[column] == null)) return null

  return JSON.stringify(
    keyColumns.map((column) => ({
      column,
      value: row[column]
    }))
  )
}

export function buildCopyValues(
  row: Record<string, unknown>,
  targetColumns: ColumnInfo[]
): Record<string, unknown> {
  return targetColumns.reduce<Record<string, unknown>>((values, column) => {
    if (column.isGenerated || !(column.name in row)) return values
    return {
      ...values,
      [column.name]: row[column.name]
    }
  }, {})
}

export function buildOverwriteTargetSyncRequest(
  options: BuildOverwriteTargetSyncRequestOptions
): SyncRequest & { dryRun: false } {
  return {
    ...(options.taskId ? { taskId: options.taskId } : {}),
    sourceConnectionId: options.sourceConnectionId,
    sourceDatabase: options.sourceDatabase,
    targetConnectionId: options.targetConnectionId,
    targetDatabase: options.targetDatabase,
    tables: [options.table],
    syncStructure: true,
    syncData: true,
    existingTableStrategy: 'overwrite-structure',
    dryRun: false
  }
}
