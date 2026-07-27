// Diff & Sync 结果区：空态 / 结果 Tab / 提示。
//
// Blueprint §3.5 state table. The two bare coloured sentences this file used to
// render (`text-emerald-400` "identical", `text-amber-400` "skipped") became an
// `EmptyState` with an action and a `Badge` — DS §7.6: an empty state without a
// way out is a dead end, and DS §0 rule 2: colour never carries meaning alone.
import type { ReactNode } from 'react'
import { CircleCheck, GitCompareArrows, TriangleAlert } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { Panel } from '@renderer/components/ui/panel'
import { useI18n } from '@renderer/i18n'
import { DiffPanelResultContainer } from './DiffPanelResultContainer'
import { getDiffPanelIdleNotice } from './diff-panel-view-state'
import type { DiffResultTab } from './diff-panel-utils'

interface DiffPanelContentAreaProps {
  showIdleNotice: boolean
  showResult: boolean
  compareDisabled: boolean
  onCompare: () => void
  resultTab: DiffResultTab
  tabItems: { value: DiffResultTab; label: ReactNode }[]
  onResultTabChange: (value: DiffResultTab) => void
  resultBody: ReactNode
  identicalNotice: string | null
  skippedNotice: string | null
  /** switches to the Content diff tab from the "rows were skipped" notice */
  onShowRowDiffs: (() => void) | null
}

export function DiffPanelContentArea({
  showIdleNotice,
  showResult,
  compareDisabled,
  onCompare,
  resultTab,
  tabItems,
  onResultTabChange,
  resultBody,
  identicalNotice,
  skippedNotice,
  onShowRowDiffs
}: DiffPanelContentAreaProps) {
  const { t } = useI18n()

  if (showIdleNotice) {
    return (
      <EmptyState
        variant="first-run"
        icon={GitCompareArrows}
        className="min-h-64"
        title={t('diff.notice.idleTitle')}
        description={getDiffPanelIdleNotice(t)}
        action={
          <Button variant="primary" disabled={compareDisabled} onClick={onCompare}>
            {t('diff.toolbar.compare')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {identicalNotice ? (
        <Panel padded={false}>
          <EmptyState
            size="sm"
            variant="no-results"
            icon={CircleCheck}
            title={t('diff.notice.identicalTitle')}
            description={identicalNotice}
            action={
              <Button size="sm" variant="secondary" disabled={compareDisabled} onClick={onCompare}>
                {t('diff.notice.compareAgain')}
              </Button>
            }
          />
        </Panel>
      ) : null}

      {skippedNotice ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warning" icon={TriangleAlert}>
            {t('diff.notice.skippedRowBadge')}
          </Badge>
          <span className="min-w-0 text-xs text-fg-muted">{skippedNotice}</span>
          {onShowRowDiffs ? (
            <Button size="xs" variant="link" onClick={onShowRowDiffs}>
              {t('diff.notice.showRowDiffs')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showResult ? (
        <DiffPanelResultContainer
          resultTab={resultTab}
          tabItems={tabItems}
          onResultTabChange={onResultTabChange}
          tabListLabel={t('diff.result.tabList')}
        >
          {resultBody}
        </DiffPanelResultContainer>
      ) : null}
    </div>
  )
}
