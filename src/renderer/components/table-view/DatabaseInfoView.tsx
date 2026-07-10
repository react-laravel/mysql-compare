import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Button } from '@renderer/components/ui/button'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import type { DatabaseInfo } from '../../../shared/types'

interface Props {
  connectionId: string
  database: string
  readOnly?: boolean
}

export function DatabaseInfoView({ connectionId, database, readOnly = false }: Props) {
  const { closeDatabaseTabs, markDatabaseDropped, showToast } = useUIStore()
  const { t } = useI18n()
  const [info, setInfo] = useState<DatabaseInfo | null>(null)
  const [deleting, setDeleting] = useState(false)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setInfo(null)
    setDeleting(false)

    void (async () => {
      try {
        const next = await unwrap(api.db.getDatabaseInfo(connectionId, database))
        if (requestId !== requestIdRef.current) return
        setInfo(next)
      } catch (error) {
        if (requestId !== requestIdRef.current) return
        showToast((error as Error).message, 'error')
      }
    })()
  }, [connectionId, database, showToast])

  const dropCurrentDatabase = async () => {
    if (deleting) return
    if (!confirm(t('sidebar.confirm.dropDatabase', { database }))) return

    setDeleting(true)
    try {
      await unwrap(
        api.db.dropDatabase({
          connectionId,
          database
        })
      )
      markDatabaseDropped(connectionId, database)
      showToast(t('sidebar.toast.droppedDatabase', { database }), 'success')
      closeDatabaseTabs(connectionId, database)
    } catch (error) {
      setDeleting(false)
      showToast((error as Error).message, 'error')
    }
  }

  if (!info) {
    return <div className="p-3 text-xs text-muted-foreground">{t('common.loading')}</div>
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <InfoCard label={readOnly ? t('databaseInfo.keys') : t('databaseInfo.tables')} value={formatNumber(info.tableCount)} />
        <InfoCard label={t('databaseInfo.rows')} value={formatNumber(info.rowEstimate)} />
        <InfoCard label={t('databaseInfo.dataSize')} value={formatBytes(info.dataLength)} />
        <InfoCard label={t('databaseInfo.indexSize')} value={formatBytes(info.indexLength)} />
        <InfoCard label={t('databaseInfo.totalSize')} value={formatBytes(info.totalSize)} />
        <InfoCard label={t('databaseInfo.freeSpace')} value={formatBytes(info.dataFree)} />
        <InfoCard label={t('databaseInfo.charset')} value={info.charset || '-'} />
        <InfoCard label={t('databaseInfo.collation')} value={info.collation || '-'} />
        <InfoCard label={t('databaseInfo.owner')} value={info.owner || '-'} />
      </div>

      <section className="mt-4 rounded-lg border border-border bg-card p-4">
        <div className="mb-2">
          <h3 className="text-sm font-medium">{t('databaseInfo.comment')}</h3>
          <div className="text-xs text-muted-foreground">{t('databaseInfo.visibleHint')}</div>
        </div>
        <div className="rounded border border-border/70 bg-background p-3 text-sm whitespace-pre-wrap break-words">
          {info.comment || <span className="text-muted-foreground">{t('databaseInfo.noComment')}</span>}
        </div>
      </section>

      {!readOnly && (
        <section className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive dark:text-red-300">
                <AlertTriangle className="h-4 w-4" />
                {t('databaseInfo.dangerZone')}
              </div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {t('databaseInfo.dropDatabaseDescription', { database })}
              </div>
            </div>
            <Button variant="destructive" onClick={dropCurrentDatabase} disabled={deleting}>
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? t('databaseInfo.droppingDatabase') : t('databaseInfo.dropDatabase')}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium">{value}</div>
    </div>
  )
}

function formatBytes(value?: number): string {
  const bytes = Math.max(0, value ?? 0)
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}

function formatNumber(value?: number): string {
  if (value == null) return '-'
  return value.toLocaleString()
}
