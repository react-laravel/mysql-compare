// 同步面板：选择策略 + 表 → 生成 SQL 预览 → 执行（带进度日志）
//
// Blueprint §2.5 / §3.5:
//   · the native `confirm()` at the execute button became a `ConfirmDialog
//     tone="danger"` naming the target `connection/database` in mono;
//   · the dialog is `dismissible={false}` while a sync runs, so a stray Esc
//     cannot hide a job that is writing to a database;
//   · the run registers in `job-store`, which is what puts it on the status bar
//     and the Diff tab's dot when the user navigates away (§2.10).
// It does NOT expose Cancel: `sync.execute` has no cancel channel (blueprint
// risk 6), and a Cancel that only stops the UI listening would be a lie.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { ConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { Panel } from '@renderer/components/ui/panel'
import { ProgressBar } from '@renderer/components/ui/progress-bar'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Select } from '@renderer/components/ui/select'
import { api, unwrap } from '@renderer/lib/api'
import { jobs } from '@renderer/store/job-store'
import { DIFF_TAB_ID, useUIStore } from '@renderer/store/ui-store'
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
  targetConnectionName?: string
  diff: DatabaseDiff
}

export function SyncPanel({
  open,
  onClose,
  source,
  target,
  sourceEngine,
  targetEngine,
  targetConnectionName,
  diff
}: Props) {
  const { showToast } = useUIStore()
  const { t } = useI18n()
  const candidateTables = useMemo(() => diff.tableDiffs.filter((item) => item.kind !== 'only-in-target').map((item) => item.table), [diff])
  const crossEngine = sourceEngine !== targetEngine

  const [selected, setSelected] = useState<Set<string>>(new Set(candidateTables))
  const [syncStructure, setSyncStructure] = useState(true)
  const [syncData, setSyncData] = useState(false)
  const [strategy, setStrategy] = useState<ExistingTableStrategy>('skip')
  const [preview, setPreview] = useState<{ plan: SyncPlan; request: SyncRequest; key: string } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const previewRunRef = useRef(0)
  const runningRef = useRef(false)
  const [outcome, setOutcome] = useState<'done' | 'error' | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total?: number; step: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const jobIdRef = useRef<string | null>(null)

  useEffect(() => {
    const off = api.sync.onProgress((event: SyncProgressEvent) => {
      const jobId = jobIdRef.current
      if (!jobId || event.taskId !== jobId) return
      setLogs((current) => [
        ...current.slice(-499),
        `[${event.level}] ${event.table} · ${event.step} ${event.done}/${event.total} ${event.message || ''}`
      ])
      setProgress({ done: event.done, total: event.total > 0 ? event.total : undefined, step: `${event.table} · ${event.step}` })
      if (jobId && event.step !== 'progress') {
        jobs.update(jobId, {
          count: { done: event.done, total: event.total },
          detail: `${event.table} · ${event.step}`
        })
      }
    })
    return off
  }, [])

  useEffect(() => {
    if (!open) return
    setSelected(new Set(candidateTables))
    setSyncStructure(!crossEngine)
    setSyncData(crossEngine)
    setPreview(null)
    setOutcome(null)
    setLogs([])
    setProgress(null)
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

  const requestKey = JSON.stringify(buildReq(true))
  const currentRequestKeyRef = useRef(requestKey)
  currentRequestKeyRef.current = requestKey
  const plan = preview?.key === requestKey ? preview.plan : null
  const validRequest = selected.size > 0 && (syncStructure || syncData)
    && !(source.connectionId === target.connectionId && source.database === target.database)

  useEffect(() => {
    previewRunRef.current += 1
    setPreview(null)
    setPreviewing(false)
    setConfirming(false)
    return () => { previewRunRef.current += 1 }
  }, [requestKey, open])

  const targetLabel = [targetConnectionName, target.database].filter(Boolean).join(' / ')

  const onPreview = async () => {
    if (runningRef.current || !validRequest) return
    const request = buildReq(true)
    const key = JSON.stringify(request)
    const runId = ++previewRunRef.current
    setPreview(null)
    setPreviewing(true)
    try {
      const next = await unwrap<SyncPlan>(submitSyncRequest(api.sync, { ...request, dryRun: true }))
      if (runId !== previewRunRef.current || key !== currentRequestKeyRef.current) return
      setPreview({ plan: next, request, key })
    } catch (err) {
      if (runId === previewRunRef.current) showToast((err as Error).message, 'error')
    } finally {
      if (runId === previewRunRef.current) setPreviewing(false)
    }
  }

  const executeSync = async () => {
    if (runningRef.current) return
    if (!plan || !preview || preview.key !== currentRequestKeyRef.current || !validRequest) {
      showToast(t('diff.sync.buildPreviewFirst'), 'error')
      return
    }
    runningRef.current = true
    setRunning(true)
    setOutcome(null)
    setLogs([])
    setProgress(null)
    const jobId = jobs.start({
      kind: 'sync',
      tabId: DIFF_TAB_ID,
      label: t('diff.job.syncing', { target: targetLabel || target.database })
    })
    jobIdRef.current = jobId
    try {
      const result = await unwrap<{ executed: number; errors: number }>(
        submitSyncRequest(api.sync, { ...preview.request, dryRun: false, taskId: jobId, planId: preview.plan.planId })
      )
      const message = t('diff.sync.executeResult', {
        executed: result.executed,
        errors: result.errors
      })
      setOutcome(result.errors === 0 ? 'done' : 'error')
      showToast(message, result.errors === 0 ? 'success' : 'error')
      jobs.finish(jobId, {
        status: result.errors === 0 ? 'done' : 'error',
        detail: message
      })
    } catch (err) {
      showToast((err as Error).message, 'error')
      setOutcome('error')
      jobs.finish(jobId, { status: 'error', detail: (err as Error).message })
    } finally {
      jobIdRef.current = null
      runningRef.current = false
      setRunning(false)
      setPreview(null)
    }
  }

  const toggle = (table: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(table)) next.delete(table)
      else next.add(table)
      return next
    })
  }

  const destructiveStrategy =
    strategy === 'overwrite-structure' || strategy === 'truncate-and-import'

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => !next && onClose()}
        title={t('diff.sync.title')}
        description={targetLabel || undefined}
        size="xl"
        dismissible={!running}
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Panel
            header={t('diff.sync.tablesToSync', {
              selected: selected.size,
              total: candidateTables.length
            })}
            padded={false}
          >
            <ScrollArea className="max-h-64">
              <ul className="space-y-0.5 p-2">
                {candidateTables.map((table) => (
                  <li key={table}>
                    <Checkbox
                      size="sm"
                      disabled={running}
                      checked={selected.has(table)}
                      onChange={() => toggle(table)}
                      label={<span className="font-mono text-xs">{table}</span>}
                    />
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </Panel>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <Checkbox
                disabled={running || crossEngine}
                checked={syncStructure}
                onChange={(event) => setSyncStructure(event.target.checked)}
                label={t('common.structure')}
              />
              <Checkbox
                disabled={running}
                checked={syncData}
                onChange={(event) => setSyncData(event.target.checked)}
                label={t('common.data')}
              />
            </div>

            {crossEngine ? (
              <Panel tone="danger" variant="bordered" header={t('diff.sync.crossEngineTitle')}>
                <p className="text-xs">{t('diff.sync.crossEngineHint')}</p>
              </Panel>
            ) : null}

            <Field
              label={t('diff.sync.ifTableExists')}
              error={destructiveStrategy ? t('diff.sync.destructiveWarning') : undefined}
            >
              <Select
                disabled={running}
                value={strategy}
                onChange={(event) => setStrategy(event.target.value as ExistingTableStrategy)}
                options={[
                  { value: 'skip', label: t('diff.sync.strategy.skip') },
                  { value: 'overwrite-structure', label: t('diff.sync.strategy.drop'), disabled: crossEngine },
                  { value: 'append-data', label: t('diff.sync.strategy.keep') },
                  { value: 'truncate-and-import', label: t('diff.sync.strategy.truncate') }
                ]}
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={onPreview} loading={previewing} disabled={running || previewing || !validRequest}>
                {t('diff.sync.previewSql')}
              </Button>
              <Button
                variant="danger"
                loading={running}
                disabled={running || previewing || !plan || !validRequest}
                onClick={() => setConfirming(true)}
              >
                {running ? t('diff.sync.running') : t('diff.sync.execute')}
              </Button>
            </div>

            {running || progress ? (
              <ProgressBar
                status={running ? 'running' : outcome ?? 'done'}
                label={running ? t('diff.sync.running') : t(outcome === 'error' ? 'statusbar.status.error' : 'statusbar.status.done')}
                detail={progress?.step}
                count={progress ? { done: progress.done, total: progress.total } : undefined}
              />
            ) : null}
          </div>
        </div>

        {plan ? (
          <Panel
            className="mt-3"
            header={t('diff.sync.preview')}
            headerActions={
              <Badge>
                {t('diff.sync.statementCount', {
                  count: plan.steps.reduce((total, step) => total + step.sqls.length, 0)
                })}
              </Badge>
            }
          >
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-inset p-2 font-mono text-xs whitespace-pre-wrap">
              {plan.steps
                .map((step) => `-- [${step.table}] ${step.description}\n${step.sqls.join('\n')}`)
                .join('\n\n')}
            </pre>
          </Panel>
        ) : null}

        {logs.length > 0 ? (
          <Panel className="mt-3" header={t('diff.sync.executionLog')}>
            <pre className="max-h-48 overflow-auto rounded-md border border-border bg-inset p-2 font-mono text-2xs">
              {logs.join('\n')}
            </pre>
          </Panel>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        tone="danger"
        title={t('diff.sync.confirmTitle')}
        body={t('diff.sync.confirmExecuteTarget')}
        subject={targetLabel || target.database}
        consequence={t('diff.sync.confirmConsequence')}
        confirmLabel={t('diff.sync.execute')}
        cancelLabel={t('common.cancel')}
        // Deliberately not awaited: the sync's progress belongs in the panel
        // behind this dialog (and in the status bar), not in a confirm button
        // that would sit spinning for the whole run.
        onConfirm={() => {
          void executeSync()
        }}
      />
    </>
  )
}
