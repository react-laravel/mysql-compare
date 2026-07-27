// Tables tab 中显示的源/目标表清单卡片，会撑满父容器高度。
//
// Blueprint §3.5: presence is a `DiffGutter` sign first and a `Badge` second —
// "only in source" green vs "only in target" amber is exactly the colour-alone
// encoding DESIGN-SYSTEM §1.5 rules out.
import { Minus, Plus } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { DiffGutter } from '@renderer/components/ui/diff-gutter'
import { Panel } from '@renderer/components/ui/panel'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import type { ComparePhase } from './diff-panel-formatters'

type Presence = 'shared' | 'source-only' | 'target-only'

interface TableListPanelProps {
  title: string
  tables: string[]
  phase: ComparePhase
  getPresence?: (table: string) => Presence
}

export function TableListPanel({ title, tables, phase, getPresence }: TableListPanelProps) {
  const { t } = useI18n()
  const loading = phase === 'loading-tables'

  return (
    <Panel header={title} headerActions={<Badge>{tables.length}</Badge>} padded={false}>
      {tables.length === 0 ? (
        <div className="p-3">
          {loading ? (
            <Skeleton variant="row" count={6} />
          ) : (
            <p className="text-xs text-fg-muted">{t('diff.result.noTablesFound')}</p>
          )}
        </div>
      ) : (
        <ScrollArea className="max-h-80">
          <ul className="space-y-0.5 p-2">
            {tables.map((table) => {
              const presence = getPresence?.(table) ?? 'shared'
              const kind =
                presence === 'source-only' ? 'add' : presence === 'target-only' ? 'del' : 'same'
              return (
                <li
                  key={table}
                  data-diff={kind}
                  className={cn(
                    'flex min-w-0 items-center gap-2 rounded-sm px-2 py-1 text-xs',
                    presence === 'source-only' && 'bg-diff-add-bg',
                    presence === 'target-only' && 'bg-diff-del-bg'
                  )}
                >
                  <DiffGutter kind={kind} />
                  <span className="min-w-0 flex-1 truncate font-mono">{table}</span>
                  {presence === 'source-only' && (
                    <Badge tone="accent" icon={Plus} className="shrink-0">
                      {t('diff.presentation.onlyInSource')}
                    </Badge>
                  )}
                  {presence === 'target-only' && (
                    <Badge tone="warning" icon={Minus} className="shrink-0">
                      {t('diff.presentation.onlyInTarget')}
                    </Badge>
                  )}
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      )}
    </Panel>
  )
}
