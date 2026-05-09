import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Label } from '@renderer/components/ui/label'
import { Select } from '@renderer/components/ui/select'
import { api } from '@renderer/lib/api'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import type {
  ExportDatabaseBackend,
  ExportDatabaseRequest,
  ExportSqlDialect
} from '../../../shared/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
}

export function ExportDatabaseDialog({ open, onOpenChange, connectionId, database }: Props) {
  const { setRightView, showToast } = useUIStore()
  const { t } = useI18n()
  const connection = useConnectionStore((state) =>
    state.connections.find((item) => item.id === connectionId)
  )
  const sourceEngine = connection?.engine ?? 'mysql'
  const connectionName = connection?.name
  const initialSqlDialect: ExportSqlDialect = sourceEngine === 'postgres' ? 'postgres' : 'mysql'
  const [sqlDialect, setSqlDialect] = useState<ExportSqlDialect>(initialSqlDialect)
  const [backend, setBackend] = useState<ExportDatabaseBackend>('builtin')
  const [includeCreateTable, setIncludeCreateTable] = useState(true)
  const [includeData, setIncludeData] = useState(true)

  const sqlDialectOptions = useMemo(
    () => [
      { value: 'mysql', label: t('exportDialog.mysqlSql') } as const,
      { value: 'postgres', label: t('exportDialog.postgresSql') } as const
    ],
    [t]
  )

  const backendOptions = useMemo(
    () => {
      const options: Array<{ value: ExportDatabaseBackend; label: string }> = [
        { value: 'builtin', label: t('databaseExportDialog.backendBuiltin') } as const,
        { value: 'mysqldump', label: t('databaseExportDialog.backendMysqldump') } as const
      ]

      if (connection?.useSSH) {
        options.push({ value: 'mysqldump-ssh', label: t('databaseExportDialog.backendMysqldumpSsh') } as const)
      }

      return options
    },
    [connection?.useSSH, t]
  )

  const canUseMySQLDump = sourceEngine === 'mysql' && sqlDialect === 'mysql'
  const canUseRemoteMySQLDump = canUseMySQLDump && connection?.useSSH === true

  useEffect(() => {
    if (!open) return
    setSqlDialect(sourceEngine === 'postgres' ? 'postgres' : 'mysql')
    setBackend('builtin')
    setIncludeCreateTable(true)
    setIncludeData(true)
  }, [connectionId, database, open, sourceEngine])

  useEffect(() => {
    if (!canUseMySQLDump && (backend === 'mysqldump' || backend === 'mysqldump-ssh')) {
      setBackend('builtin')
      return
    }

    if (!canUseRemoteMySQLDump && backend === 'mysqldump-ssh') {
      setBackend('builtin')
    }
  }, [backend, canUseMySQLDump, canUseRemoteMySQLDump])

  const canExport = includeCreateTable || includeData

  const submit = async () => {
    if (!canExport) {
      showToast(t('exportDialog.selectSqlContent'), 'error')
      return
    }

    if (typeof api.db.exportDatabase !== 'function') {
      showToast(t('databaseExportDialog.unavailable'), 'error')
      return
    }

    const request: ExportDatabaseRequest = {
      connectionId,
      database,
      format: 'sql',
      sqlDialect,
      backend,
      includeCreateTable,
      includeData
    }

    const exportTaskId =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

    onOpenChange(false)
    setRightView({
      kind: 'database-export',
      exportTaskId,
      connectionName,
      request
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('databaseExportDialog.title')}
      description={database}
      className="max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!canExport}>
            {t('common.export')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label className="mb-1 block">{t('exportDialog.sqlDialect')}</Label>
          <Select
            value={sqlDialect}
            onChange={(event) => setSqlDialect(event.target.value as ExportSqlDialect)}
            options={sqlDialectOptions}
          />
        </div>

        {sourceEngine === 'mysql' && canUseMySQLDump && (
          <div>
            <Label className="mb-1 block">{t('databaseExportDialog.backend')}</Label>
            <Select
              value={backend}
              onChange={(event) => setBackend(event.target.value as ExportDatabaseBackend)}
              options={backendOptions}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {backend === 'mysqldump-ssh'
                ? t('databaseExportDialog.backendHintSsh')
                : t('databaseExportDialog.backendHintLocal')}
            </p>
          </div>
        )}

        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={includeCreateTable}
              onChange={(event) => setIncludeCreateTable(event.target.checked)}
            />
            {t('common.structure')}
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={includeData} onChange={(event) => setIncludeData(event.target.checked)} />
            {t('common.data')}
          </label>
        </div>
      </div>
    </Dialog>
  )
}
