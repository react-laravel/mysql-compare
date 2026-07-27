// 纯展示用的格式化工具，从 DiffPanel.tsx 抽出，便于复用与单元测试。
import type { TableDataDiff } from '../../../shared/types'
import type { Translator } from '@renderer/i18n'

/**
 * `cancelled` is a first-class peer of `done` (DESIGN-SYSTEM §7): the partial
 * results stay on screen and the Compare button comes back.
 */
export type ComparePhase = 'idle' | 'loading-tables' | 'comparing' | 'done' | 'cancelled'

export function formatComparePhase(
  phase: ComparePhase,
  completedSharedTableCount: number,
  sharedTableCount: number,
  pendingSharedTable: string | undefined,
  t: Translator
): string {
  if (phase === 'loading-tables') return t('diff.phase.loadingTables')
  if (phase === 'comparing') {
    const vars = { done: completedSharedTableCount, total: sharedTableCount }
    return pendingSharedTable
      ? t('diff.phase.comparingPending', { ...vars, pending: pendingSharedTable })
      : t('diff.phase.comparing', vars)
  }
  if (phase === 'cancelled') {
    return t('diff.phase.cancelled', {
      done: completedSharedTableCount,
      total: sharedTableCount
    })
  }
  if (phase === 'done') {
    return sharedTableCount === 0
      ? t('diff.phase.doneNoShared')
      : t('diff.phase.done', { done: completedSharedTableCount, total: sharedTableCount })
  }
  return t('diff.phase.ready')
}

export function formatCompareButtonLabel(
  phase: ComparePhase,
  completedSharedTableCount: number,
  sharedTableCount: number,
  t: Translator
): string {
  if (phase === 'loading-tables') return t('diff.toolbar.loadingTables')
  if (phase === 'comparing')
    return t('diff.toolbar.comparingProgress', {
      done: completedSharedTableCount,
      total: sharedTableCount
    })
  return t('diff.toolbar.compare')
}

export function formatCompareSetupSummary(
  {
    sourceConnectionName,
    sourceDatabase,
    targetConnectionName,
    targetDatabase,
    compareData
  }: {
    sourceConnectionName?: string
    sourceDatabase: string
    targetConnectionName?: string
    targetDatabase: string
    compareData: boolean
  },
  t: Translator
): string {
  if (!sourceConnectionName && !targetConnectionName && !sourceDatabase && !targetDatabase) {
    return t('diff.setupSummary.empty')
  }

  const sourceLabel =
    [sourceConnectionName, sourceDatabase].filter(Boolean).join(' / ') ||
    t('diff.setupSummary.sourcePending')
  const targetLabel =
    [targetConnectionName, targetDatabase].filter(Boolean).join(' / ') ||
    t('diff.setupSummary.targetPending')

  return t('diff.setupSummary.template', {
    source: sourceLabel,
    target: targetLabel,
    state: compareData ? t('diff.setupSummary.stateOn') : t('diff.setupSummary.stateOff')
  })
}

export function formatEndpointSelectionSummary(
  connectionName: string | undefined,
  database: string,
  fallback: string
): string {
  const parts = [connectionName, database].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : fallback
}

export function buildDatabaseOptions(
  connectionId: string,
  databases: string[],
  loading: boolean,
  t: Translator
) {
  if (!connectionId) {
    return [{ value: '', label: t('diff.databaseOption.selectConnectionFirst') }]
  }
  if (loading) {
    return [{ value: '', label: t('diff.databaseOption.loadingDatabases') }]
  }
  return [
    { value: '', label: t('diff.databaseOption.placeholder') },
    ...databases.map((database) => ({ value: database, label: database }))
  ]
}

export function formatColumnLine(
  c: { name: string; type: string; nullable: boolean } | undefined,
  kind: string,
  side: string
): string | null {
  if (!c) return null
  if (kind === 'only-in-source' && side === 'target') return null
  if (kind === 'only-in-target' && side === 'source') return null
  return `${c.name}  ${c.type}  ${c.nullable ? 'NULL' : 'NOT NULL'}`
}

export function formatIndexLine(
  i: { name: string; columns: string[]; unique: boolean } | undefined,
  kind: string,
  side: string
): string | null {
  if (!i) return null
  if (kind === 'only-in-source' && side === 'target') return null
  if (kind === 'only-in-target' && side === 'source') return null
  return `${i.unique ? 'UNIQUE ' : ''}${i.name} (${i.columns.join(', ')})`
}

export function formatDataSummary(dataDiff: TableDataDiff, t: Translator): string {
  if (!dataDiff.comparable) return t('diff.dataSummary.skipped')
  const totalDiffs = dataDiff.sourceOnly + dataDiff.targetOnly + dataDiff.modified
  return totalDiffs === 0
    ? t('diff.dataSummary.identical')
    : t('diff.dataSummary.diffs', { count: totalDiffs })
}
