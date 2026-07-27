import type { ReactNode } from 'react'
import { Badge } from '@renderer/components/ui/badge'
import type { DatabaseDiff } from '../../../shared/types'
import type { Translator } from '@renderer/i18n'
import type { ComparePhase } from './diff-panel-formatters'
import type { DiffPanelToolbarSummary } from './DiffPanelToolbar'
import type { DiffResultTab } from './diff-panel-utils'

interface BuildDiffPanelTabItemsArgs {
  sourceTableCount: number
  targetTableCount: number
  comparisonEntryCount: number
  compareErrorCount: number
  visibleSchemaDiffCount: number
  compareData: boolean
  rowChangedTableCount: number
  rowSkippedTableCount: number
}

interface BuildDiffPanelToolbarSummaryArgs {
  diff: DatabaseDiff | null
  comparePhase: ComparePhase
  rowChangedTableCount: number
  rowSkippedTableCount: number
}

export function buildDiffPanelTabItems(
  {
    sourceTableCount,
    targetTableCount,
    comparisonEntryCount,
    compareErrorCount,
    visibleSchemaDiffCount,
    compareData,
    rowChangedTableCount,
    rowSkippedTableCount
  }: BuildDiffPanelTabItemsArgs,
  t: Translator
): { value: DiffResultTab; label: ReactNode }[] {
  return [
    {
      value: 'tables',
      label: (
        <span className="flex items-center gap-2">
          <span>{t('diff.tabs.tables')}</span>
          <Badge>
            {t('diff.tabs.sBadge', { count: sourceTableCount })}
          </Badge>
          <Badge>
            {t('diff.tabs.tBadge', { count: targetTableCount })}
          </Badge>
        </span>
      )
    },
    {
      value: 'status',
      label: (
        <span className="flex items-center gap-2">
          <span>{t('diff.tabs.status')}</span>
          <Badge>
            {comparisonEntryCount}
          </Badge>
          {compareErrorCount > 0 && (
            <Badge tone="danger">{t('diff.tabs.errors', { count: compareErrorCount })}</Badge>
          )}
        </span>
      )
    },
    {
      value: 'schema',
      label: (
        <span className="flex items-center gap-2">
          <span>{t('diff.tabs.structureDiff')}</span>
          <Badge>
            {t('diff.tabs.changed', { count: visibleSchemaDiffCount })}
          </Badge>
          {compareErrorCount > 0 && (
            <Badge tone="danger">{t('diff.tabs.errors', { count: compareErrorCount })}</Badge>
          )}
        </span>
      )
    },
    ...(compareData
      ? [
          {
            value: 'data' as const,
            label: (
              <span className="flex items-center gap-2">
                <span>{t('diff.tabs.contentDiff')}</span>
                <Badge>
                  {t('diff.tabs.changed', { count: rowChangedTableCount })}
                </Badge>
                {rowSkippedTableCount > 0 && (
                  <Badge tone="warning">
                    {t('diff.tabs.skipped', { count: rowSkippedTableCount })}
                  </Badge>
                )}
                {compareErrorCount > 0 && (
                  <Badge tone="danger">
                    {t('diff.tabs.errors', { count: compareErrorCount })}
                  </Badge>
                )}
              </span>
            )
          }
        ]
      : [])
  ]
}

export function buildDiffPanelToolbarSummary({
  diff,
  comparePhase,
  rowChangedTableCount,
  rowSkippedTableCount
}: BuildDiffPanelToolbarSummaryArgs): DiffPanelToolbarSummary | null {
  if (!diff) return null

  return {
    structureDiffCount: diff.tableDiffs.length,
    checkedRowCount: diff.rowComparisons.length,
    rowChangedTableCount,
    rowSkippedTableCount,
    rowsIdentical:
      comparePhase === 'done' && rowChangedTableCount === 0 && rowSkippedTableCount === 0
  }
}

export function getFullyIdenticalNotice(compareData: boolean, t: Translator): string {
  return compareData ? t('diff.notice.identicalAll') : t('diff.notice.identicalSchema')
}

export function getDiffPanelIdleNotice(t: Translator): string {
  return t('diff.notice.idle')
}

export function getDiffPanelSkippedRowNotice(t: Translator): string {
  return t('diff.notice.skippedRow')
}