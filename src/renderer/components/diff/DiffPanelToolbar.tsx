// Diff & Sync 的视图工具栏。
//
// Blueprint §3.5 / §2.3. What changed and why:
//   · the button whose *label* carried the progress and that was `disabled`
//     while running is now a `primary` Compare with a peer **Cancel** — a
//     compare over 40 tables is never under 1.5s, so DS §7.3 makes cancel
//     mandatory;
//   · progress moved to `Toolbar.progress`, a 2px line on the toolbar's bottom
//     edge, so it costs zero layout;
//   · "Compare rows" and "Parallel workers" left the primary surface for the
//     `⋯` (they are also in Settings and in ⌘K — DS §9 rule 1);
//   · "Plan sync" keeps its disabled logic but explains itself instead of
//     being a dead control.
import { GitCompareArrows, Square } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import type { MenuItem } from '@renderer/components/ui/dropdown-menu'
import type { ProgressState } from '@renderer/components/ui/progress-bar'
import { Toolbar } from '@renderer/components/ui/toolbar'
import { Tooltip } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/i18n'

export interface DiffPanelToolbarSummary {
  structureDiffCount: number
  checkedRowCount: number
  rowChangedTableCount: number
  rowSkippedTableCount: number
  rowsIdentical: boolean
}

interface DiffPanelToolbarProps {
  subtitle: string
  compareButtonLabel: string
  compareData: boolean
  diffSummary: DiffPanelToolbarSummary | null
  loading: boolean
  canCancel: boolean
  canPlanSync: boolean
  planSyncDisabledReason: string
  progress: ProgressState | null
  progressLabel: string | null
  overflow: MenuItem[]
  onCompare: () => void
  onCancel: () => void
  onPlanSync: () => void
}

export function DiffPanelToolbar({
  subtitle,
  compareButtonLabel,
  compareData,
  diffSummary,
  loading,
  canCancel,
  canPlanSync,
  planSyncDisabledReason,
  progress,
  progressLabel,
  overflow,
  onCompare,
  onCancel,
  onPlanSync
}: DiffPanelToolbarProps) {
  const { t } = useI18n()

  const planSync = (
    <Button size="sm" variant="secondary" disabled={!canPlanSync} onClick={onPlanSync}>
      {t('diff.toolbar.planSync')}
    </Button>
  )

  return (
    <Toolbar
      icon={GitCompareArrows}
      title={t('app.diffSync')}
      subtitle={subtitle}
      progress={progress}
      overflowLabel={t('common.moreActions')}
      overflow={overflow}
      actions={
        <>
          {canCancel ? (
            <Button size="sm" variant="danger-ghost" icon={Square} onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            loading={loading}
            disabled={loading}
            onClick={onCompare}
          >
            {compareButtonLabel}
          </Button>
          {canPlanSync ? (
            planSync
          ) : (
            // A disabled button never receives pointer events, so the tooltip
            // hangs off a wrapper (PRIMITIVES §10).
            <Tooltip content={planSyncDisabledReason} side="bottom">
              <span className="inline-flex">{planSync}</span>
            </Tooltip>
          )}
        </>
      }
      filters={
        progressLabel || diffSummary ? (
          <div
            className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-fg-muted"
            aria-live="polite"
          >
            {progressLabel ? <span className="text-fg">{progressLabel}</span> : null}
            {diffSummary ? (
              <>
                <Badge>
                  {t('diff.toolbar.structure', { count: diffSummary.structureDiffCount })}
                </Badge>
                {compareData && diffSummary.checkedRowCount > 0 ? (
                  <>
                    <Badge>
                      {t('diff.toolbar.checked', { count: diffSummary.checkedRowCount })}
                    </Badge>
                    {diffSummary.rowsIdentical ? (
                      <Badge tone="success">{t('diff.toolbar.rowsIdentical')}</Badge>
                    ) : (
                      <Badge>
                        {t('diff.toolbar.changed', { count: diffSummary.rowChangedTableCount })}
                      </Badge>
                    )}
                  </>
                ) : null}
                {compareData && diffSummary.rowSkippedTableCount > 0 ? (
                  <Badge tone="warning">
                    {t('diff.toolbar.skipped', { count: diffSummary.rowSkippedTableCount })}
                  </Badge>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null
      }
    />
  )
}
