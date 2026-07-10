import { useEffect, useMemo, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { useI18n } from '@renderer/i18n'
import { api, unwrap } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
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
  const { registerTabCloseGuard, showToast } = useUIStore()
  const [runVersion, setRunVersion] = useState(0)
  const [status, setStatus] = useState<ExportTaskStatus>('running')
  const [result, setResult] = useState<ExportDatabaseResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (status !== 'running') return

    return registerTabCloseGuard(`database-export:${taskId}`, () => confirm(t('databaseExportTask.confirmCloseRunning')))
  }, [registerTabCloseGuard, status, t, taskId])

  useEffect(() => {
    const runKey = `${taskId}:${runVersion}`
    if (startedExportRuns.has(runKey)) return

    startedExportRuns.add(runKey)

    const runExport = async () => {
      setStatus('running')
      setResult(null)
      setErrorMessage(null)

      try {
        if (typeof api.db.exportDatabase !== 'function') {
          throw new Error(t('databaseExportDialog.unavailable'))
        }

        const nextResult = await unwrap<ExportDatabaseResult>(api.db.exportDatabase(request))
        setResult(nextResult)

        if (nextResult.canceled) {
          setStatus('canceled')
          return
        }

        setStatus('success')
        showToast(getExportMessage(nextResult, t), 'success')
      } catch (error) {
        const message = (error as Error).message
        setErrorMessage(message)
        setStatus('error')
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-background">
      <div className="border-b border-border bg-card px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{t('databaseExportTask.title')}</div>
            <div className="truncate text-xs text-muted-foreground">
              {request.database}
              {connectionName ? ` @ ${connectionName}` : ''}
            </div>
          </div>
          <div className={cn('rounded-full px-2.5 py-1 text-xs font-medium', statusClassName(status))}>
            {t(`databaseExportTask.status.${status}`)}
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-medium">{t('databaseExportTask.progressTitle')}</div>
          <p className="mt-2 text-sm text-muted-foreground">{t(`databaseExportTask.message.${status}`)}</p>
          {status === 'error' && errorMessage && (
            <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </p>
          )}
          {status === 'success' && result && !result.canceled && (
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <div>
                {result.backend === 'mysqldump' && result.rowsCountAccurate === false
                  ? t('databaseExportTask.summaryFast', { tables: result.tablesExported })
                  : t('databaseExportTask.summary', {
                      tables: result.tablesExported,
                      rows: result.rowsExported
                    })}
              </div>
              {result.filePath && (
                <div className="break-all rounded-md border border-border/80 bg-background px-3 py-2 font-mono text-xs text-foreground">
                  {result.filePath}
                </div>
              )}
            </div>
          )}
          {(status === 'error' || status === 'canceled') && (
            <div className="mt-4">
              <Button onClick={() => setRunVersion((value) => value + 1)}>{t('databaseExportTask.retry')}</Button>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-medium">{t('databaseExportTask.requestTitle')}</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {requestSummary.map((item) => (
              <div key={`${taskId}:${item.label}`} className="rounded-md border border-border/70 bg-background px-3 py-2">
                <div className="text-xs text-muted-foreground">{item.label}</div>
                <div className="mt-1 text-sm font-medium">{item.value}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
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

function statusClassName(status: ExportTaskStatus): string {
  if (status === 'success') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  if (status === 'error') return 'bg-destructive/15 text-destructive'
  if (status === 'canceled') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
  return 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
}
