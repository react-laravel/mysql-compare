// 数据库导出任务标签页（blueprint §3.8 / §2.10）。
//
// 以前它只是"一个标签页里的一段文字"：切走之后应用看起来完全空闲。现在导出会
// 登记进 `job-store`，于是同一份状态同时出现在标签页状态点和状态栏任务列表里；
// 关闭正在运行的标签页走 `ConfirmDialog`，不再是 `window.confirm`。
import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download, RefreshCw } from 'lucide-react'
import { Badge, type Tone } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { ConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import type { MenuItem } from '@renderer/components/ui/dropdown-menu'
import { Panel } from '@renderer/components/ui/panel'
import type { JobStatus } from '@renderer/components/ui/progress-bar'
import { STATUS_ICON } from '@renderer/components/ui/status-dot'
import { StatTile } from '@renderer/components/ui/stat-tile'
import { Toolbar } from '@renderer/components/ui/toolbar'
import { useI18n } from '@renderer/i18n'
import { api, unwrap } from '@renderer/lib/api'
import { jobs } from '@renderer/store/job-store'
import { useUIStore } from '@renderer/store/ui-store'
import type { ExportDatabaseRequest, ExportDatabaseResult } from '../../../shared/types'

type ExportTaskStatus = 'running' | 'success' | 'canceled' | 'error'

const startedExportRuns = new Set<string>()

interface DatabaseExportTaskViewProps {
  taskId: string
  connectionName?: string
  request: ExportDatabaseRequest
}

export function DatabaseExportTaskView({ taskId, connectionName, request }: DatabaseExportTaskViewProps) {
  const { t } = useI18n()
  const { closeTab, registerTabCloseGuard, showToast } = useUIStore()
  const [runVersion, setRunVersion] = useState(0)
  const [status, setStatus] = useState<ExportTaskStatus>('running')
  const [result, setResult] = useState<ExportDatabaseResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const closeConfirmedRef = useRef(false)
  const tabId = `database-export:${taskId}`

  useEffect(() => {
    if (status !== 'running') return

    return registerTabCloseGuard(tabId, (reason) => {
      if (closeConfirmedRef.current) return true
      // `check`（批量关闭）不弹框：提问方自己负责确认，否则三个导出会叠三个框。
      if (reason === 'close') setConfirmClose(true)
      return false
    })
  }, [registerTabCloseGuard, status, tabId])

  useEffect(() => {
    const runKey = `${taskId}:${runVersion}`
    if (startedExportRuns.has(runKey)) return

    startedExportRuns.add(runKey)

    const runExport = async () => {
      setStatus('running')
      setResult(null)
      setErrorMessage(null)

      // `db.exportDatabase` 既没有进度事件也没有取消通道，所以这条任务是
      // 不确定进度、且**不带** `onCancel` —— 状态栏不会给出一个假的取消按钮
      // （blueprint risk 6）。
      const jobId = jobs.start({
        kind: 'export',
        tabId,
        label: t('databaseExportTask.jobLabel', { database: request.database })
      })

      try {
        if (typeof api.db.exportDatabase !== 'function') {
          throw new Error(t('databaseExportDialog.unavailable'))
        }

        const nextResult = await unwrap<ExportDatabaseResult>(api.db.exportDatabase(request))
        setResult(nextResult)

        if (nextResult.canceled) {
          setStatus('canceled')
          jobs.finish(jobId, { status: 'cancelled' })
          return
        }

        setStatus('success')
        jobs.finish(jobId, { detail: nextResult.filePath })
        showToast(getExportMessage(nextResult, t), 'success')
      } catch (error) {
        const message = (error as Error).message
        setErrorMessage(message)
        setStatus('error')
        jobs.finish(jobId, { status: 'error', detail: message })
        showToast(message, 'error')
      }
    }

    void runExport()
  }, [request, runVersion, taskId])

  const requestSummary = useMemo(
    () => [
      { label: t('exportDialog.sqlDialect'), value: formatDialect(request.sqlDialect, t) },
      { label: t('databaseExportDialog.backend'), value: formatBackend(request.backend, t) },
      { label: t('common.structure'), value: request.includeCreateTable === false ? t('common.no') : t('common.yes') },
      { label: t('common.data'), value: request.includeData === false ? t('common.no') : t('common.yes') }
    ],
    [request.backend, request.includeCreateTable, request.includeData, request.sqlDialect, t]
  )

  const filePath = result && !result.canceled ? result.filePath : undefined

  const overflow: MenuItem[] = [
    {
      id: 'retry',
      icon: RefreshCw,
      label: t('databaseExportTask.retry'),
      disabled: status === 'running',
      disabledReason: t('databaseExportTask.status.running'),
      onSelect: () => setRunVersion((value) => value + 1)
    },
    {
      id: 'copy-path',
      icon: Copy,
      label: t('databaseExportTask.copyPath'),
      disabled: !filePath,
      disabledReason: t('databaseExportTask.noFileYet'),
      onSelect: () => {
        if (!filePath) return
        void navigator.clipboard.writeText(filePath)
        showToast(t('databaseExportTask.pathCopied'), 'success')
      }
    }
  ]

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas">
      <Toolbar
        icon={Download}
        title={t('databaseExportTask.title')}
        subtitle={
          <span className="font-mono">
            {request.database}
            {connectionName ? ` @ ${connectionName}` : ''}
          </span>
        }
        progress={
          status === 'running'
            ? { status: 'running', label: t(`databaseExportTask.status.${status}`) }
            : null
        }
        overflowLabel={t('common.moreActions')}
        overflow={overflow}
        actions={
          <>
            <Badge tone={EXPORT_STATUS_TONE[status]} icon={STATUS_ICON[EXPORT_JOB_STATUS[status]]}>
              {t(`databaseExportTask.status.${status}`)}
            </Badge>
            {status === 'error' || status === 'canceled' ? (
              <Button
                size="sm"
                variant="primary"
                icon={RefreshCw}
                onClick={() => setRunVersion((value) => value + 1)}
              >
                {t('databaseExportTask.retry')}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <Panel header={t('databaseExportTask.progressTitle')}>
          <p className="text-sm text-fg-muted">{t(`databaseExportTask.message.${status}`)}</p>
          {status === 'error' && errorMessage && (
            <p className="mt-3 rounded-md border border-danger/30 bg-danger-quiet px-3 py-2 text-sm text-danger-text">
              {errorMessage}
            </p>
          )}
          {status === 'success' && result && !result.canceled && (
            <div className="mt-3 space-y-2 text-sm text-fg-muted">
              <div>
                {result.backend === 'mysqldump' && result.rowsCountAccurate === false
                  ? t('databaseExportTask.summaryFast', { tables: result.tablesExported })
                  : t('databaseExportTask.summary', {
                      tables: result.tablesExported,
                      rows: result.rowsExported
                    })}
              </div>
              {result.filePath && (
                <div className="break-all rounded-md border border-border bg-inset px-3 py-2 font-mono text-xs text-fg">
                  {result.filePath}
                </div>
              )}
            </div>
          )}
        </Panel>

        <Panel header={t('databaseExportTask.requestTitle')}>
          <div className="grid gap-3 sm:grid-cols-2">
            {requestSummary.map((item) => (
              <StatTile key={`${taskId}:${item.label}`} size="sm" label={item.label} value={item.value} />
            ))}
          </div>
        </Panel>
      </div>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        tone="danger"
        title={t('databaseExportTask.confirmCloseTitle')}
        subject={request.database}
        body={t('databaseExportTask.confirmCloseRunning')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('databaseExportTask.closeAnyway')}
        onConfirm={() => {
          closeConfirmedRef.current = true
          setConfirmClose(false)
          closeTab(tabId)
        }}
      />
    </div>
  )
}

function getExportMessage(result: ExportDatabaseResult, t: ReturnType<typeof useI18n>['t']): string {
  return isMySQLDumpBackend(result.backend) && result.rowsCountAccurate === false
    ? t('databaseExportDialog.exportedFast', { tables: result.tablesExported })
    : t('databaseExportDialog.exported', {
        tables: result.tablesExported,
        rows: result.rowsExported
      })
}

function formatDialect(value: ExportDatabaseRequest['sqlDialect'], t: ReturnType<typeof useI18n>['t']): string {
  return value === 'postgres' ? t('exportDialog.postgresSql') : t('exportDialog.mysqlSql')
}

function formatBackend(value: ExportDatabaseRequest['backend'], t: ReturnType<typeof useI18n>['t']): string {
  if (value === 'mysqldump-ssh') return t('databaseExportDialog.backendMysqldumpSsh')
  return value === 'mysqldump'
    ? t('databaseExportDialog.backendMysqldump')
    : t('databaseExportDialog.backendBuiltin')
}

function isMySQLDumpBackend(value: ExportDatabaseResult['backend']): boolean {
  return value === 'mysqldump' || value === 'mysqldump-ssh'
}

/** The shared status vocabulary, identical to the SSH terminal's. */
const EXPORT_JOB_STATUS: Record<ExportTaskStatus, JobStatus> = {
  running: 'running',
  success: 'done',
  canceled: 'cancelled',
  error: 'error'
}

const EXPORT_STATUS_TONE: Record<ExportTaskStatus, Tone> = {
  running: 'running',
  success: 'success',
  canceled: 'warning',
  error: 'danger'
}
