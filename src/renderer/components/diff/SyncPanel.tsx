// 同步面板：选择策略 + 表 → 生成 SQL 预览 → 执行（带进度日志）
import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Select } from '@renderer/components/ui/select'
import { Label } from '@renderer/components/ui/label'
import { Badge } from '@renderer/components/ui/badge'
import { api, unwrap } from '@renderer/lib/api'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import type {
  DatabaseDiff,
  DbEngine,
  ExistingTableStrategy,
  SyncPlan,
  SyncProgressEvent,
  SyncRequest
} from '../../../shared/types'
import { submitSyncRequest } from './sync-request'

interface Props {
  open: boolean
  onClose: () => void
  source: { connectionId: string; database: string }
  target: { connectionId: string; database: string }
  sourceEngine: DbEngine
  targetEngine: DbEngine
  diff: DatabaseDiff
}

export function SyncPanel({
  open,
  onClose,
  source,
  target,
  sourceEngine,
  targetEngine,
  diff
}: Props) {
  const { showToast } = useUIStore()
  const { t } = useI18n()
  const candidateTables = useMemo(() => diff.tableDiffs.map((t) => t.table), [diff])
  const crossEngine = sourceEngine !== targetEngine

  const [selected, setSelected] = useState<Set<string>>(new Set(candidateTables))
  const [syncStructure, setSyncStructure] = useState(true)
  const [syncData, setSyncData] = useState(false)
  const [strategy, setStrategy] = useState<ExistingTableStrategy>('skip')
  const [plan, setPlan] = useState<SyncPlan | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const off = api.sync.onProgress((e: SyncProgressEvent) => {
      setLogs((l) => [...l, `[${e.level}] ${e.table} · ${e.step} ${e.done}/${e.total} ${e.message || ''}`])
    })
    return off
  }, [])

  useEffect(() => {
    if (!open) return
    setSelected(new Set(candidateTables))
    setSyncStructure(true)
    setSyncData(crossEngine)
    setPlan(null)
  }, [candidateTables, crossEngine, open])

  function buildReq(dryRun: true): SyncRequest & { dryRun: true }
  function buildReq(dryRun: false): SyncRequest & { dryRun: false }
  function buildReq(dryRun: boolean): SyncRequest {
    return {
      sourceConnectionId: source.connectionId,
      sourceDatabase: source.database,
      targetConnectionId: target.connectionId,
      targetDatabase: target.database,
      tables: Array.from(selected),
      syncStructure,
      syncData,
      existingTableStrategy: strategy,
      dryRun
    }
  }

  const onPreview = async () => {
    try {
      const p = await unwrap<SyncPlan>(submitSyncRequest(api.sync, buildReq(true)))
      setPlan(p)
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  const onExecute = async () => {
    if (!plan) {
      showToast(t('diff.sync.buildPreviewFirst'), 'error')
      return
    }
    if (!confirm(t('diff.sync.confirmExecuteTarget'))) return
    setRunning(true)
    setLogs([])
    try {
      const r = await unwrap<{ executed: number; errors: number }>(submitSyncRequest(api.sync, buildReq(false)))
      showToast(
        t('diff.sync.executeResult', { executed: r.executed, errors: r.errors }),
        r.errors === 0 ? 'success' : 'error'
      )
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setRunning(false)
    }
  }

  const toggle = (t: string) => {
    setSelected((s) => {
      const n = new Set(s)
      n.has(t) ? n.delete(t) : n.add(t)
      return n
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('diff.sync.title')} className="max-w-5xl">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>{t('diff.sync.tablesToSync', { selected: selected.size, total: candidateTables.length })}</Label>
          <div className="border border-border rounded max-h-64 overflow-auto p-2 space-y-1 mt-1">
            {candidateTables.map((t) => (
              <label key={t} className="flex items-center gap-2 text-xs">
                <Checkbox checked={selected.has(t)} onChange={() => toggle(t)} />
                {t}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={syncStructure}
                onChange={(e) => setSyncStructure(e.target.checked)}
              />
              {t('common.structure')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={syncData} onChange={(e) => setSyncData(e.target.checked)} />
              {t('common.data')}
            </label>
          </div>
          {crossEngine && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              {t('diff.sync.crossEngineHint')}
            </div>
          )}
          <div>
            <Label>{t('diff.sync.ifTableExists')}</Label>
            <Select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as ExistingTableStrategy)}
              options={[
                { value: 'skip', label: t('diff.sync.strategy.skip') },
                { value: 'overwrite-structure', label: t('diff.sync.strategy.drop') },
                { value: 'append-data', label: t('diff.sync.strategy.keep') },
                { value: 'truncate-and-import', label: t('diff.sync.strategy.truncate') }
              ]}
            />
            {(strategy === 'overwrite-structure' || strategy === 'truncate-and-import') && (
              <div className="mt-1 text-[11px] text-amber-400">
                {t('diff.sync.destructiveWarning')}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onPreview}>{t('diff.sync.previewSql')}</Button>
            <Button variant="destructive" onClick={onExecute} disabled={running || !plan}>
              {running ? t('diff.sync.running') : t('diff.sync.execute')}
            </Button>
          </div>
        </div>
      </div>

      {plan && (
        <div className="mt-4">
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
            {t('diff.sync.preview')} <Badge>{t('diff.sync.statementCount', { count: plan.steps.reduce((s, x) => s + x.sqls.length, 0) })}</Badge>
          </div>
          <pre className="bg-card border border-border rounded p-3 text-xs max-h-64 overflow-auto whitespace-pre-wrap">
{plan.steps.map((s) => `-- [${s.table}] ${s.description}\n${s.sqls.join('\n')}`).join('\n\n')}
          </pre>
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-muted-foreground mb-1">{t('diff.sync.executionLog')}</div>
          <pre className="bg-card border border-border rounded p-3 text-[11px] max-h-48 overflow-auto">
{logs.join('\n')}
          </pre>
        </div>
      )}
    </Dialog>
  )
}
