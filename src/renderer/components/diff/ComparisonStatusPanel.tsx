import { AlertCircle, CheckCircle2, CircleDashed, LoaderCircle } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useI18n, type Translator } from '@renderer/i18n'
import type { TableRowComparison } from '../../../shared/types'
import {
  hasNoRowDifferences,
  hasSchemaOrPresenceDiff,
  type TableCompareEntry
} from './diff-panel-utils'

interface ComparisonStatusPanelProps {
  entries: TableCompareEntry[]
  selectedTable: string | null
  onSelectTable: (table: string) => void
  onOpenCompare: (table: string) => void
  onOpenSource: (table: string) => void
  onOpenTarget: (table: string) => void
}

export function ComparisonStatusPanel({
  entries,
  selectedTable,
  onSelectTable,
  onOpenCompare,
  onOpenSource,
  onOpenTarget
}: ComparisonStatusPanelProps) {
  const { t } = useI18n()
  if (entries.length === 0) {
    return <div className="text-xs text-muted-foreground">{t('diff.result.noTablesMatch')}</div>
  }

  const selectedEntry = entries.find((entry) => entry.table === selectedTable) ?? entries[0] ?? null

  return (
    <div className="grid grid-cols-1 gap-3 xl:items-start xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.9fr)]">
      <div className="grid auto-rows-max content-start grid-cols-1 gap-2 lg:grid-cols-2">
        {entries.map((entry) => (
          <CompactComparisonCard
            key={entry.table}
            entry={entry}
            selected={selectedEntry?.table === entry.table}
            onSelect={() => onSelectTable(entry.table)}
          />
        ))}
      </div>
      <ComparisonDetailDrawer
        entry={selectedEntry}
        onOpenCompare={selectedEntry ? () => onOpenCompare(selectedEntry.table) : undefined}
        onOpenSource={selectedEntry ? () => onOpenSource(selectedEntry.table) : undefined}
        onOpenTarget={selectedEntry ? () => onOpenTarget(selectedEntry.table) : undefined}
      />
    </div>
  )
}

function CompactComparisonCard({
  entry,
  selected,
  onSelect
}: {
  entry: TableCompareEntry
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'rounded border px-3 py-2 text-left text-xs transition-colors',
        selected
          ? 'border-primary/40 bg-accent/30'
          : 'border-border/60 bg-card/40 hover:border-border hover:bg-card/60'
      )}
    >
      <div className="flex items-start gap-2 min-w-0">
        <TableStatusIcon status={entry.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate font-medium">{entry.table}</span>
            <span className="ml-auto text-[10px] text-muted-foreground whitespace-nowrap">
              {formatEntryStatus(entry, t)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <EntrySummaryBadges entry={entry} />
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {selected ? t('diff.status.viewing') : t('diff.status.details')}
        </span>
      </div>
    </button>
  )
}

function ComparisonDetailDrawer({
  entry,
  onOpenCompare,
  onOpenSource,
  onOpenTarget
}: {
  entry: TableCompareEntry | null
  onOpenCompare?: () => void
  onOpenSource?: () => void
  onOpenTarget?: () => void
}) {
  const { t } = useI18n()
  if (!entry) {
    return (
      <div className="rounded border border-dashed border-border/60 bg-card/20 px-4 py-6 text-sm xl:sticky xl:top-4 xl:max-h-[calc(100vh-7rem)] xl:self-start xl:overflow-auto">
        <div className="font-medium text-foreground">{t('diff.status.noTableSelected')}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t('diff.status.selectTablePrompt')}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 xl:sticky xl:top-4 xl:max-h-[calc(100vh-7rem)] xl:self-start xl:overflow-auto">
      <div className="flex items-start gap-2 border-b border-border/60 px-4 py-3">
        <TableStatusIcon status={entry.status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{entry.table}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <EntrySummaryBadges entry={entry} />
          </div>
        </div>
      </div>
      <div className="space-y-3 px-4 py-3 text-xs">
        {entry.error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive dark:text-red-300 break-all">
            {entry.error}
          </div>
        )}
        <div className="rounded-md bg-card/70 px-3 py-2">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">{t('common.summary')}</div>
          <div className="text-[11px] text-muted-foreground">{formatEntryDetailSummary(entry, t)}</div>
        </div>
        {entry.tableDiff && (
          <div className="rounded-md bg-card/70 px-3 py-2">
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">{t('common.structure')}</div>
            <div className="text-[11px] text-muted-foreground">
              {t('diff.status.columnDiffCount', { count: entry.tableDiff.columnDiffs.length })} · {t('diff.status.indexDiffCount', { count: entry.tableDiff.indexDiffs.length })}
            </div>
          </div>
        )}
        {entry.rowComparison && (
          <div className="rounded-md bg-card/70 px-3 py-2">
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">{t('common.content')}</div>
            <div className="text-[11px] text-muted-foreground">{formatRowComparisonSummary(entry.rowComparison, t)}</div>
          </div>
        )}
        <ComparisonActionButtons
          compareAvailable={entry.sourceExists && entry.targetExists}
          sourceAvailable={entry.sourceExists}
          targetAvailable={entry.targetExists}
          onOpenCompare={onOpenCompare}
          onOpenSource={onOpenSource ?? (() => undefined)}
          onOpenTarget={onOpenTarget ?? (() => undefined)}
        />
      </div>
    </div>
  )
}

function EntrySummaryBadges({ entry }: { entry: TableCompareEntry }) {
  const { t } = useI18n()
  const items = getEntrySummaryBadges(entry, t)

  if (items.length === 0) {
    return <Badge className="border border-border/60 bg-card/70 text-muted-foreground">{t('diff.status.ready')}</Badge>
  }

  return items.map((item) => (
    <Badge
      key={`${entry.table}-${item.label}`}
      variant={item.variant}
      className={item.variant === 'default' ? 'border border-border/60 bg-card/70 text-muted-foreground' : undefined}
    >
      {item.label}
    </Badge>
  ))
}

function getEntrySummaryBadges(
  entry: TableCompareEntry,
  t: Translator
): Array<{ label: string; variant: 'default' | 'info' | 'warning' | 'destructive' | 'success' }> {
  const items: Array<{ label: string; variant: 'default' | 'info' | 'warning' | 'destructive' | 'success' }> = []

  if (entry.status === 'error') {
    items.push({ label: t('diff.status.error'), variant: 'destructive' })
    return items
  }

  if (!entry.sourceExists) {
    items.push({ label: t('diff.status.targetOnly'), variant: 'warning' })
    return items
  }

  if (!entry.targetExists) {
    items.push({ label: t('diff.status.sourceOnly'), variant: 'info' })
    return items
  }

  if (entry.status === 'comparing') {
    items.push({ label: t('diff.status.running'), variant: 'info' })
  }

  if (entry.tableDiff && hasSchemaOrPresenceDiff(entry.tableDiff)) {
    items.push({ label: t('diff.status.schema'), variant: 'destructive' })
  }

  if (entry.rowComparison) {
    if (!entry.rowComparison.dataDiff.comparable) {
      items.push({ label: t('diff.status.rowsSkipped'), variant: 'warning' })
    } else if (!hasNoRowDifferences(entry.rowComparison)) {
      items.push({ label: t('diff.status.rowsChanged'), variant: 'destructive' })
    } else if (!entry.tableDiff) {
      items.push({ label: t('diff.status.identical'), variant: 'success' })
    }
  }

  if (items.length === 0 && entry.status === 'queued') {
    items.push({ label: t('diff.status.queued'), variant: 'default' })
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

function TableStatusIcon({ status }: { status: TableCompareEntry['status'] }) {
  if (status === 'comparing') {
    return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-sky-700 dark:text-sky-300" />
  }
  if (status === 'done') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
  }
  if (status === 'error') {
    return <AlertCircle className="h-3.5 w-3.5 text-destructive dark:text-red-300" />
  }
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
}

function formatEntryStatus(entry: TableCompareEntry, t: Translator): string {
  if (entry.status === 'error') return t('diff.status.failed')
  if (!entry.sourceExists) return t('diff.status.targetOnly')
  if (!entry.targetExists) return t('diff.status.sourceOnly')
  if (entry.status === 'queued') return t('diff.status.queued')
  if (entry.status === 'comparing') return t('diff.status.comparing')
  if (entry.rowComparison && !entry.rowComparison.dataDiff.comparable) return t('diff.status.rowSkipped')
  if (entry.rowComparison && hasNoRowDifferences(entry.rowComparison) && !entry.tableDiff) return t('diff.status.identical')
  if (!entry.rowComparison && !entry.tableDiff) return t('diff.status.noDifferencesShort')
  return t('diff.status.ready')
}

function ComparisonActionButtons({
  compareAvailable,
  sourceAvailable,
  targetAvailable,
  onOpenCompare,
  onOpenSource,
  onOpenTarget
}: {
  compareAvailable?: boolean
  sourceAvailable: boolean
  targetAvailable: boolean
  onOpenCompare?: () => void
  onOpenSource: () => void
  onOpenTarget: () => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {compareAvailable && onOpenCompare && (
        <Button size="sm" variant="outline" onClick={onOpenCompare}>
          Open Compare
        </Button>
      )}
      {sourceAvailable && (
        <Button size="sm" variant="ghost" onClick={onOpenSource}>
          Open Source
        </Button>
      )}
      {targetAvailable && (
        <Button size="sm" variant="ghost" onClick={onOpenTarget}>
          Open Target
        </Button>
      )}
    </div>
  )
}
