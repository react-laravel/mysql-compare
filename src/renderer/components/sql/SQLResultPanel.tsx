// The bottom pane of the SQL console: one of five states, per blueprint §3.4.
//
//   idle      → `EmptyState variant="first-run"` with Run as its action
//               (replaces the dashed box at the old `SQLQueryView.tsx:374-377`)
//   error     → `Panel tone="danger"`, message in mono, driver text in
//               `<details>` (replaces the dark-only `text-red-200` at `:368`)
//   rows      → `DataTable variant="report"` under a count `Badge`
//   mutation  → `StatTile`s for affected rows / insert id / warnings
//   batch     → `StatTile`s + the per-statement list
//   explain   → `SQLExplainPanel`
import { useMemo } from 'react'
import { ClipboardCopy, Play } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { DataTable, type Column } from '@renderer/components/ui/data-table'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { Panel } from '@renderer/components/ui/panel'
import { StatTile } from '@renderer/components/ui/stat-tile'
import { formatCellValue } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import { SQLExplainPanel } from './SQLExplainPanel'
import { splitErrorMessage, type CopyFormat, type SQLExecutionResult } from './sql-result-normalize'

interface Props {
  result: SQLExecutionResult | null
  error: string | null
  running: boolean
  /** the endpoint label used by the idle hint — `prod / shop` */
  subtitle: string
  onRun: () => void
  onCopyRows: (format: CopyFormat) => void
  onCopyExplainJson: () => void
}

type ResultRow = Record<string, unknown>

export function SQLResultPanel({
  result,
  error,
  running,
  subtitle,
  onRun,
  onCopyRows,
  onCopyExplainJson
}: Props) {
  const { t } = useI18n()

  if (error) return <SQLErrorPanel error={error} />

  if (!result) {
    return (
      <EmptyState
        variant="first-run"
        icon={Play}
        title={t('sql.idleTitle')}
        description={t('sql.runHint', { subtitle })}
        action={
          <Button variant="primary" icon={Play} loading={running} onClick={onRun}>
            {t('sql.run')}
          </Button>
        }
        shortcut="Mod+Enter"
      />
    )
  }

  if (result.kind === 'explain') {
    return <SQLExplainPanel result={result.result} onCopyJson={onCopyExplainJson} />
  }

  if (result.kind === 'rows') {
    return <SQLRowsPanel columns={result.columns} rows={result.rows} onCopyRows={onCopyRows} />
  }

  if (result.kind === 'empty') {
    return (
      <Panel header={t('sql.resultTitle')}>
        <p className="text-sm text-fg-muted">{result.message}</p>
      </Panel>
    )
  }

  if (result.kind === 'mutation') {
    return (
      <Panel header={t('sql.resultTitle')}>
        <div className="grid gap-2 sm:grid-cols-3">
          <StatTile label={t('sql.statLabels.affectedRows')} value={result.affectedRows} mono />
          {result.insertId !== undefined ? (
            <StatTile label={t('sql.statLabels.insertId')} value={String(result.insertId)} mono />
          ) : null}
          {result.warningStatus !== undefined ? (
            <StatTile label={t('sql.statLabels.warnings')} value={result.warningStatus} mono />
          ) : null}
        </div>
      </Panel>
    )
  }

  return (
    <Panel header={t('sql.resultTitle')}>
      <div className="grid gap-2 sm:grid-cols-2">
        <StatTile label={t('sql.statLabels.statements')} value={result.statements} mono />
        <StatTile label={t('sql.statLabels.totalAffected')} value={result.affectedRows} mono />
      </div>
      {result.details.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-fg-muted">
          {result.details.map((detail, index) => (
            <li key={index}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </Panel>
  )
}

function SQLRowsPanel({
  columns,
  rows,
  onCopyRows
}: {
  columns: string[]
  rows: ResultRow[]
  onCopyRows: (format: CopyFormat) => void
}) {
  const { t } = useI18n()

  const tableColumns = useMemo<Column<ResultRow>[]>(
    () =>
      columns.map((column) => ({
        id: column,
        header: column,
        mono: true,
        cellClassName: 'whitespace-pre-wrap break-all align-top',
        title: (row) => formatCellValue(row[column]),
        cell: (row) => formatCellValue(row[column])
      })),
    [columns]
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <Badge tone="accent">{t('sql.rowCount', { count: rows.length.toLocaleString() })}</Badge>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={ClipboardCopy} onClick={() => onCopyRows('tsv')}>
            {t('sql.copyTsv')}
          </Button>
          <Button size="sm" variant="ghost" icon={ClipboardCopy} onClick={() => onCopyRows('json')}>
            {t('sql.copyJson')}
          </Button>
        </div>
      </div>
      <DataTable
        className="flex-1"
        columns={tableColumns}
        rows={rows}
        rowKey={(_row, index) => String(index)}
        variant="report"
        aria-label={t('sql.resultTitle')}
      />
    </div>
  )
}

function SQLErrorPanel({ error }: { error: string }) {
  const { t } = useI18n()
  const { headline, detail } = splitErrorMessage(error)

  return (
    <Panel tone="danger" header={t('sql.errorTitle')} role="alert">
      <p className="font-mono text-xs leading-5 break-all whitespace-pre-wrap text-danger-text">
        {headline}
      </p>
      {detail ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-fg-muted">{t('sql.errorDetails')}</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-inset p-2 font-mono text-2xs leading-5 break-words whitespace-pre-wrap text-fg-muted">
            {detail}
          </pre>
        </details>
      ) : null}
    </Panel>
  )
}
