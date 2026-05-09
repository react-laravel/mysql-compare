import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Label } from '@renderer/components/ui/label'
import { Select } from '@renderer/components/ui/select'
import { api, unwrap } from '@renderer/lib/api'
import { useUIStore } from '@renderer/store/ui-store'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useI18n } from '@renderer/i18n'
import type {
  ExportFormat,
  ExportScope,
  ExportSqlDialect,
  ExportTableRequest,
  ExportTableResult
} from '../../../shared/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  table: string
  where?: string
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
  page?: number
  pageSize?: number
  selectedRows?: Record<string, unknown>[]
  availableScopes?: ExportScope[]
}

export function ExportTableDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  table,
  where,
  orderBy,
  page,
  pageSize,
  selectedRows = [],
  availableScopes = ['all', 'filtered', 'page']
}: Props) {
  const { showToast } = useUIStore()
  const { t } = useI18n()
  const sourceEngine = useConnectionStore(
    (state) => state.connections.find((connection) => connection.id === connectionId)?.engine ?? 'mysql'
  )
  const initialSqlDialect: ExportSqlDialect = sourceEngine === 'postgres' ? 'postgres' : 'mysql'
  const [format, setFormat] = useState<ExportFormat>('sql')
  const [sqlDialect, setSqlDialect] = useState<ExportSqlDialect>(initialSqlDialect)
  const [scope, setScope] = useState<ExportScope>(availableScopes[0] ?? 'all')
  const [includeCreateTable, setIncludeCreateTable] = useState(true)
  const [includeData, setIncludeData] = useState(true)
  const [includeHeaders, setIncludeHeaders] = useState(true)
  const [busy, setBusy] = useState(false)

  const scopeOptions = useMemo(
    () =>
      availableScopes.map((value) => ({
        value,
        label: t(`exportDialog.scopeOptions.${value}`)
      })),
    [availableScopes, t]
  )
  const sqlDialectOptions = useMemo(
    () => [
      { value: 'mysql', label: t('exportDialog.mysqlSql') } as const,
      { value: 'postgres', label: t('exportDialog.postgresSql') } as const
    ],
    [t]
  )

  useEffect(() => {
    if (!open) return
    setFormat('sql')
    setSqlDialect(sourceEngine === 'postgres' ? 'postgres' : 'mysql')
    setScope(availableScopes[0] ?? 'all')
    setIncludeCreateTable(true)
    setIncludeData(true)
    setIncludeHeaders(true)
  }, [availableScopes, connectionId, database, open, sourceEngine, table])

  const canExport = format === 'sql' ? includeCreateTable || includeData : true

  const submit = async () => {
    if (!canExport) {
      showToast(t('exportDialog.selectSqlContent'), 'error')
      return
    }

    const request: ExportTableRequest = {
      connectionId,
      database,
      table,
      format,
      sqlDialect: format === 'sql' ? sqlDialect : undefined,
      scope,
      where: scope === 'all' ? undefined : where,
      orderBy,
      page,
      pageSize,
      selectedRows: scope === 'selected' ? selectedRows : undefined,
      includeCreateTable,
      includeData,
      includeHeaders
    }

    setBusy(true)
    try {
      const result = await unwrap<ExportTableResult>(api.db.exportTable(request))
      if (!result.canceled) {
        const message =
          format === 'sql' && includeCreateTable && !includeData
            ? t('exportDialog.exportedStructure')
            : t('exportDialog.exportedRows', { count: result.rowsExported })
        showToast(message, 'success')
        onOpenChange(false)
      }
    } catch (error) {
      showToast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('exportDialog.title')}
      description={`${database}.${table}`}
      className="max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy || !canExport}>
            {busy ? t('exportDialog.exporting') : t('common.export')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label className="block mb-1">{t('exportDialog.format')}</Label>
          <Select
            value={format}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
            options={[
              { value: 'sql', label: t('exportDialog.sql') },
              { value: 'csv', label: t('exportDialog.csv') },
              { value: 'txt', label: t('exportDialog.text') }
            ]}
          />
        </div>

        {format === 'sql' && (
          <div>
            <Label className="block mb-1">{t('exportDialog.sqlDialect')}</Label>
            <Select
              value={sqlDialect}
              onChange={(event) => setSqlDialect(event.target.value as ExportSqlDialect)}
              options={sqlDialectOptions}
            />
          </div>
        )}

        <div>
          <Label className="block mb-1">{t('exportDialog.scope')}</Label>
          <Select
            value={scope}
            onChange={(event) => setScope(event.target.value as ExportScope)}
            options={scopeOptions}
            disabled={scopeOptions.length === 1}
          />
          {scope === 'filtered' && !where?.trim() && (
            <div className="mt-1 text-xs text-muted-foreground">
              {t('exportDialog.noFilterHint')}
            </div>
          )}
        </div>

        {format === 'sql' ? (
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={includeCreateTable} onChange={(event) => setIncludeCreateTable(event.target.checked)} />
              {t('exportDialog.includeCreateTable')}
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={includeData} onChange={(event) => setIncludeData(event.target.checked)} />
              {t('exportDialog.includeInsert')}
            </label>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={includeHeaders} onChange={(event) => setIncludeHeaders(event.target.checked)} />
              {t('exportDialog.includeHeader')}
            </label>
            <div className="text-xs text-muted-foreground">
              {t('exportDialog.textHint')}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
