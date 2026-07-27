// The EXPLAIN result: a visual plan tree beside the raw driver rows.
//
// Blueprint §3.4 keeps this two-pane layout ("unchanged two-pane plan view,
// tokens only"); what changed is that the metric chips are `Badge`s, the raw
// rows are a `DataTable variant="report"`, and the `text-[11px]` literal became
// `text-2xs`.
import { useMemo } from 'react'
import { ClipboardCopy } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { DataTable, type Column } from '@renderer/components/ui/data-table'
import { Panel } from '@renderer/components/ui/panel'
import { formatCellValue } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import type { ExplainPlanNode, ExplainSQLResult } from '../../../shared/types'

interface Props {
  result: ExplainSQLResult
  onCopyJson: () => void
}

type ExplainRow = Record<string, unknown>

export function SQLExplainPanel({ result, onCopyJson }: Props) {
  const { t } = useI18n()

  const columns = useMemo<Column<ExplainRow>[]>(
    () =>
      result.columns.map((column) => ({
        id: column,
        header: column,
        mono: true,
        cellClassName: 'whitespace-pre-wrap break-all align-top',
        title: (row) => formatCellValue(row[column]),
        cell: (row) => formatCellValue(row[column])
      })),
    [result.columns]
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs text-fg-muted">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-fg">{t('sql.explainPlan')}</span>
          <Badge>{result.engine === 'postgres' ? 'PostgreSQL' : 'MySQL'}</Badge>
          {result.summary.map((metric) => (
            <Badge key={`${metric.label}:${metric.value}`} variant="outline">
              {metric.label}: {String(metric.value)}
            </Badge>
          ))}
        </div>
        <Button size="sm" variant="ghost" icon={ClipboardCopy} onClick={onCopyJson}>
          {t('sql.copyJson')}
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-3 lg:grid-cols-[minmax(20rem,0.9fr)_minmax(26rem,1.1fr)]">
        <Panel
          variant="inset"
          header={t('sql.visualPlan')}
          className="min-h-0 overflow-hidden"
          bodyClassName="flex-1 overflow-auto"
        >
          {result.plan ? (
            <PlanNodeView node={result.plan} />
          ) : (
            <div className="text-sm text-fg-muted">{t('sql.noVisualPlan')}</div>
          )}
        </Panel>
        <Panel
          variant="inset"
          header={t('sql.rawExplainRows')}
          padded={false}
          className="min-h-0 overflow-hidden"
          bodyClassName="flex-1 overflow-auto"
        >
          {result.rows.length === 0 ? (
            <div className="p-3 text-sm text-fg-muted">{t('sql.noRows')}</div>
          ) : (
            <DataTable
              columns={columns}
              rows={result.rows}
              rowKey={(_row, index) => String(index)}
              variant="report"
              aria-label={t('sql.rawExplainRows')}
            />
          )}
        </Panel>
      </div>
    </div>
  )
}

function PlanNodeView({ node, depth = 0 }: { node: ExplainPlanNode; depth?: number }) {
  return (
    <div className="relative">
      <div
        className="mb-2 rounded-md border border-border bg-surface p-2"
        style={{ marginLeft: depth === 0 ? 0 : 14 }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-medium">{node.label}</div>
          {node.detail ? <div className="text-xs text-fg-muted">{node.detail}</div> : null}
        </div>
        {node.metrics.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {node.metrics.map((metric) => (
              <Badge key={`${node.id}:${metric.label}`} size="xs" variant="outline">
                {metric.label}: {String(metric.value)}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      {node.children.map((child) => (
        <PlanNodeView key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}
