// Status tab：左侧每张表一行，右侧是选中表的详情。
//
// Blueprint §3.5: the local `TableStatusIcon` map (a hand-picked emerald /
// sky / danger set) is gone — per-table status now comes from the shared
// vocabulary (`STATUS_ICON` + `Badge`), the schema detail renders real
// `DiffGutter` lines instead of two bare counts, and a failed table keeps its
// message *and* gains a per-row Retry.
import { RefreshCw } from 'lucide-react'
import { Badge, type Tone } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { DiffGutter } from '@renderer/components/ui/diff-gutter'
import { Panel } from '@renderer/components/ui/panel'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { STATUS_ICON, statusTone, type JobStatus } from '@renderer/components/ui/status-dot'
import { cn } from '@renderer/lib/utils'
import { useI18n, type Translator } from '@renderer/i18n'
import type { TableRowComparison } from '../../../shared/types'
import type { ComparePhase } from './diff-panel-formatters'
import { formatColumnLine, formatIndexLine } from './diff-panel-formatters'
import { schemaLineDiffKind, type DiffLine } from './diff-panel-presentation'
import {
  hasNoRowDifferences,
  hasSchemaOrPresenceDiff,
  type TableCompareEntry
} from './diff-panel-utils'

interface ComparisonStatusPanelProps {
  entries: TableCompareEntry[]
  comparePhase: ComparePhase
  selectedTable: string | null
  onSelectTable: (table: string) => void
  onOpenCompare: (table: string) => void
  onOpenSource: (table: string) => void
  onOpenTarget: (table: string) => void
  onRetryTable: (table: string) => void
}

const TONE_INK: Record<Tone, string> = {
  neutral: 'text-fg-muted',
  accent: 'text-accent-text',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
  running: 'text-running-text',
  idle: 'text-fg-muted'
}

/**
 * A cancelled run leaves entries sitting on `queued` / `comparing`; showing a
 * spinner that will never resolve would be a lie, so the phase decides what a
 * still-unfinished entry reads as. `TableCompareEntry` itself is defined in the
 * pure `diff-panel-utils` module this chunk leaves untouched.
 */
export function entryDisplayStatus(entry: TableCompareEntry, phase: ComparePhase): JobStatus {
  if (entry.status === 'error') return 'error'
  if (entry.status === 'done') return 'done'
  if (phase === 'cancelled') return 'cancelled'
  if (entry.status === 'comparing') return 'running'
  return 'queued'
}

function StatusGlyph({ status }: { status: JobStatus }) {
  const Icon = STATUS_ICON[status]
  return (
    <Icon
      aria-hidden
      strokeWidth={1.75}
      className={cn(
        'size-3.5 shrink-0',
        status === 'running' && 'animate-spin-slow',
        TONE_INK[statusTone(status)]
      )}
    />
  )
}

export function ComparisonStatusPanel({
  entries,
  comparePhase,
  selectedTable,
  onSelectTable,
  onOpenCompare,
  onOpenSource,
  onOpenTarget,
  onRetryTable
}: ComparisonStatusPanelProps) {
  const { t } = useI18n()
  if (entries.length === 0) {
    return <div className="text-xs text-fg-muted">{t('diff.result.noTablesMatch')}</div>
  }

  const selectedEntry = entries.find((entry) => entry.table === selectedTable) ?? entries[0] ?? null

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.9fr)] xl:items-start">
      {/* No scroller of its own: this list *is* the view's content, and the
          page already owns exactly one scroll region (DESIGN-SYSTEM §2). */}
      <Panel padded={false}>
        <div role="listbox" aria-label={t('diff.result.tabList')} className="p-1">
          {entries.map((entry) => (
            <ComparisonRow
              key={entry.table}
              entry={entry}
              status={entryDisplayStatus(entry, comparePhase)}
              selected={selectedEntry?.table === entry.table}
              onSelect={() => onSelectTable(entry.table)}
            />
          ))}
        </div>
      </Panel>
      <ComparisonDetail
        entry={selectedEntry}
        status={selectedEntry ? entryDisplayStatus(selectedEntry, comparePhase) : 'idle'}
        onOpenCompare={selectedEntry ? () => onOpenCompare(selectedEntry.table) : undefined}
        onOpenSource={selectedEntry ? () => onOpenSource(selectedEntry.table) : undefined}
        onOpenTarget={selectedEntry ? () => onOpenTarget(selectedEntry.table) : undefined}
        onRetry={selectedEntry ? () => onRetryTable(selectedEntry.table) : undefined}
      />
    </div>
  )
}

function ComparisonRow({
  entry,
  status,
  selected,
  onSelect
}: {
  entry: TableCompareEntry
  status: JobStatus
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useI18n()
  const badges = getEntrySummaryBadges(entry, t)
  const statusText = formatEntryStatus(entry, t)
  // "audit_log · target only · target only" — don't say it twice.
  const showStatusText = !badges.some((badge) => badge.label === statusText)
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      data-focus-inset
      className={cn(
        // DS §5: the 2px left accent bar is the signal, the wash reinforces it.
        'flex w-full min-w-0 items-center gap-2 rounded-sm border-l-2 px-2 py-1 text-left text-xs transition-colors',
        selected
          ? 'border-l-accent bg-selected text-fg'
          : 'border-l-transparent text-fg-muted hover:bg-hover hover:text-fg'
      )}
    >
      <StatusGlyph status={status} />
      <span className="min-w-0 flex-1 truncate font-mono text-fg">{entry.table}</span>
      <span className="flex shrink-0 items-center gap-1">
        {badges.length === 0 ? (
          <Badge>{t('diff.status.ready')}</Badge>
        ) : (
          badges.map((badge) => (
            <Badge key={`${entry.table}-${badge.label}`} tone={badge.tone}>
              {badge.label}
            </Badge>
          ))
        )}
      </span>
      {showStatusText ? (
        <span className="w-24 shrink-0 truncate text-right text-2xs text-fg-subtle">
          {statusText}
        </span>
      ) : null}
    </button>
  )
}

function ComparisonDetail({
  entry,
  status,
  onOpenCompare,
  onOpenSource,
  onOpenTarget,
  onRetry
}: {
  entry: TableCompareEntry | null
  status: JobStatus
  onOpenCompare?: () => void
  onOpenSource?: () => void
  onOpenTarget?: () => void
  onRetry?: () => void
}) {
  const { t } = useI18n()
  if (!entry) {
    return (
      <Panel header={t('diff.status.noTableSelected')}>
        <p className="text-xs text-fg-muted">{t('diff.status.selectTablePrompt')}</p>
      </Panel>
    )
  }

  const schemaLines = entry.tableDiff ? buildSchemaLines(entry.tableDiff) : []

  return (
    <Panel
      className="xl:sticky xl:top-3"
      header={
        <span className="flex min-w-0 items-center gap-2">
          <StatusGlyph status={status} />
          <span className="truncate font-mono">{entry.table}</span>
        </span>
      }
      headerActions={
        entry.status === 'error' && onRetry ? (
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={onRetry}>
            {t('common.retry')}
          </Button>
        ) : null
      }
    >
      <div className="flex min-w-0 flex-col gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          <EntrySummaryBadges entry={entry} />
        </div>

        {entry.error ? (
          <div className="rounded-md border border-danger/30 bg-danger-quiet px-2 py-1.5 break-all text-danger-text">
            {entry.error}
          </div>
        ) : null}

        <div className="rounded-md bg-inset px-2 py-1.5">
          <div className="mb-1 text-2xs font-medium text-fg-muted">{t('common.summary')}</div>
          <div className="text-2xs text-fg-muted">{formatEntryDetailSummary(entry, t)}</div>
        </div>

        {schemaLines.length > 0 ? (
          <div>
            <div className="mb-1 text-2xs font-medium text-fg-muted">{t('common.structure')}</div>
            <ScrollArea className="max-h-56">
              <ul className="space-y-0.5 font-mono text-2xs">
                {schemaLines.map((line, index) => (
                  <li
                    key={index}
                    data-diff={line.kind}
                    className={cn(
                      'flex min-w-0 items-start gap-2 rounded-sm px-2 py-1',
                      line.kind === 'add' && 'bg-diff-add-bg',
                      line.kind === 'del' && 'bg-diff-del-bg',
                      line.kind === 'mod' && 'bg-diff-mod-bg'
                    )}
                  >
                    <DiffGutter kind={line.kind} />
                    <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{line.text}</span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        ) : null}

        {entry.rowComparison ? (
          <div className="rounded-md bg-inset px-2 py-1.5">
            <div className="mb-1 text-2xs font-medium text-fg-muted">{t('common.content')}</div>
            <div className="text-2xs text-fg-muted">
              {formatRowComparisonSummary(entry.rowComparison, t)}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1">
          {entry.sourceExists && entry.targetExists && onOpenCompare ? (
            <Button size="sm" variant="secondary" onClick={onOpenCompare}>
              {t('diff.presentation.openCompare')}
            </Button>
          ) : null}
          {entry.sourceExists && onOpenSource ? (
            <Button size="sm" variant="ghost" onClick={onOpenSource}>
              {t('diff.presentation.openSource')}
            </Button>
          ) : null}
          {entry.targetExists && onOpenTarget ? (
            <Button size="sm" variant="ghost" onClick={onOpenTarget}>
              {t('diff.presentation.openTarget')}
            </Button>
          ) : null}
        </div>
      </div>
    </Panel>
  )
}

/**
 * One merged `+ / − / ~` list for the detail pane — the shape blueprint §3.5
 * sketches next to the table list.
 */
function buildSchemaLines(tableDiff: NonNullable<TableCompareEntry['tableDiff']>): DiffLine[] {
  const lines: DiffLine[] = []

  for (const columnDiff of tableDiff.columnDiffs) {
    const side = columnDiff.kind === 'only-in-target' ? 'target' : 'source'
    const info = side === 'target' ? columnDiff.target : columnDiff.source
    const text = formatColumnLine(info, columnDiff.kind, side)
    if (!text) continue
    lines.push({ text, kind: schemaLineDiffKind(columnDiff.kind, side) })
  }

  for (const indexDiff of tableDiff.indexDiffs) {
    const side = indexDiff.kind === 'only-in-target' ? 'target' : 'source'
    const info = side === 'target' ? indexDiff.target : indexDiff.source
    const text = formatIndexLine(info, indexDiff.kind, side)
    if (!text) continue
    lines.push({ text, kind: schemaLineDiffKind(indexDiff.kind, side) })
  }

  return lines
}

function EntrySummaryBadges({ entry }: { entry: TableCompareEntry }) {
  const { t } = useI18n()
  const items = getEntrySummaryBadges(entry, t)

  if (items.length === 0) {
    return <Badge>{t('diff.status.ready')}</Badge>
  }

  return items.map((item) => (
    <Badge key={`${entry.table}-${item.label}`} tone={item.tone}>
      {item.label}
    </Badge>
  ))
}

function getEntrySummaryBadges(
  entry: TableCompareEntry,
  t: Translator
): Array<{ label: string; tone: Tone }> {
  const items: Array<{ label: string; tone: Tone }> = []

  if (entry.status === 'error') {
    items.push({ label: t('diff.status.error'), tone: 'danger' })
    return items
  }

  if (!entry.sourceExists) {
    items.push({ label: t('diff.status.targetOnly'), tone: 'warning' })
    return items
  }

  if (!entry.targetExists) {
    items.push({ label: t('diff.status.sourceOnly'), tone: 'accent' })
    return items
  }

  if (entry.status === 'comparing') {
    items.push({ label: t('diff.status.running'), tone: 'running' })
  }

  if (entry.tableDiff && hasSchemaOrPresenceDiff(entry.tableDiff)) {
    items.push({ label: t('diff.status.schema'), tone: 'danger' })
  }

  if (entry.rowComparison) {
    if (!entry.rowComparison.dataDiff.comparable) {
      items.push({ label: t('diff.status.rowsSkipped'), tone: 'warning' })
    } else if (!hasNoRowDifferences(entry.rowComparison)) {
      items.push({ label: t('diff.status.rowsChanged'), tone: 'danger' })
    } else if (!entry.tableDiff) {
      items.push({ label: t('diff.status.identical'), tone: 'success' })
    }
  }

  if (items.length === 0 && entry.status === 'queued') {
    items.push({ label: t('diff.status.queued'), tone: 'idle' })
  }

  return items
}

function formatEntryDetailSummary(entry: TableCompareEntry, t: Translator): string {
  if (entry.status === 'error') {
    return t('diff.status.errorRetryHint')
  }

  if (!entry.sourceExists) {
    return t('diff.status.tableTargetOnly')
  }

  if (!entry.targetExists) {
    return t('diff.status.tableSourceOnly')
  }

  const detailParts: string[] = []

  if (entry.tableDiff) {
    detailParts.push(
      t('diff.status.columnDiffCount', { count: entry.tableDiff.columnDiffs.length }),
      t('diff.status.indexDiffCount', { count: entry.tableDiff.indexDiffs.length })
    )
  }

  if (entry.rowComparison) {
    const { dataDiff } = entry.rowComparison
    if (!dataDiff.comparable) {
      detailParts.push(t('diff.status.rowCompareSkipped'))
    } else {
      detailParts.push(
        t('diff.status.modifiedCount', { count: dataDiff.modified }),
        t('diff.status.sourceOnlyCount', { count: dataDiff.sourceOnly }),
        t('diff.status.targetOnlyCount', { count: dataDiff.targetOnly }),
        t('diff.status.identicalCount', { count: dataDiff.identical })
      )
    }
  }

  return detailParts.length > 0 ? detailParts.join(' · ') : t('diff.status.noDifferences')
}

function formatRowComparisonSummary(rowComparison: TableRowComparison, t: Translator): string {
  const { dataDiff } = rowComparison
  if (!dataDiff.comparable) {
    return dataDiff.reason || t('diff.status.rowComparisonSkipped')
  }

  return [
    t('diff.status.modifiedCount', { count: dataDiff.modified }),
    t('diff.status.sourceOnlyCount', { count: dataDiff.sourceOnly }),
    t('diff.status.targetOnlyCount', { count: dataDiff.targetOnly }),
    t('diff.status.identicalCount', { count: dataDiff.identical })
  ].join(' · ')
}

function formatEntryStatus(entry: TableCompareEntry, t: Translator): string {
  if (entry.status === 'error') return t('diff.status.failed')
  if (!entry.sourceExists) return t('diff.status.targetOnly')
  if (!entry.targetExists) return t('diff.status.sourceOnly')
  if (entry.status === 'queued') return t('diff.status.queued')
  if (entry.status === 'comparing') return t('diff.status.comparing')
  if (entry.rowComparison && !entry.rowComparison.dataDiff.comparable)
    return t('diff.status.rowSkipped')
  if (entry.rowComparison && hasNoRowDifferences(entry.rowComparison) && !entry.tableDiff)
    return t('diff.status.identical')
  if (!entry.rowComparison && !entry.tableDiff) return t('diff.status.noDifferencesShort')
  return t('diff.status.ready')
}
