// 数据库信息视图：统计、备注与危险区。
//
// Blueprint §3.3: the same layout as the table Info tab with nine tiles, and
// "Drop database…" carries `requireTypedConfirmation` — the one destructive
// action in the app that can take a whole schema with it.
import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Button } from '@renderer/components/ui/button'
import { ConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Panel } from '@renderer/components/ui/panel'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { StatTile } from '@renderer/components/ui/stat-tile'
import { Toolbar } from '@renderer/components/ui/toolbar'
import { formatBytes, formatNumber } from '@renderer/lib/format'
import { useAppAction } from '@renderer/lib/app-actions'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import type { DatabaseInfo } from '../../../shared/types'

interface Props {
  connectionId: string
  connectionName?: string
  database: string
  readOnly?: boolean
  active?: boolean
}

export function DatabaseInfoView({
  connectionId,
  connectionName,
  database,
  readOnly = false,
  active = true
}: Props) {
  const { closeDatabaseTabs, markDatabaseDropped, showToast } = useUIStore()
  const { t } = useI18n()
  const [info, setInfo] = useState<DatabaseInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDrop, setConfirmingDrop] = useState(false)
  const requestIdRef = useRef(0)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setInfo(null)
    setLoadError(null)
    setLoading(true)
    setDeleting(false)
    setConfirmingDrop(false)

    void (async () => {
      try {
        const next = await unwrap(api.db.getDatabaseInfo(connectionId, database))
        if (requestId !== requestIdRef.current) return
        setInfo(next)
      } catch (error) {
        if (requestId !== requestIdRef.current) return
        setLoadError(error instanceof Error ? error : new Error(String(error)))
        showToast((error as Error).message, 'error')
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    })()
  }, [connectionId, database, reloadToken, showToast])

  const reload = () => setReloadToken((current) => current + 1)
  useAppAction('refresh-view', active ? reload : null)

  const dropCurrentDatabase = async () => {
    if (deleting) return

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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <Toolbar
        title={<span className="font-mono">{database}</span>}
        subtitle={connectionName}
        progress={loading ? { status: 'running', label: t('common.loading') } : null}
        overflowLabel={t('common.moreActions')}
        overflow={
          readOnly
            ? undefined
            : [
                {
                  id: 'drop-database',
                  icon: Trash2,
                  label: t('databaseInfo.dropDatabase'),
                  danger: true,
                  onSelect: () => setConfirmingDrop(true)
                }
              ]
        }
        actions={
          <IconButton
            icon={RefreshCw}
            label={t('common.refresh')}
            shortcut="Mod+R"
            size="sm"
            variant="ghost"
            loading={loading}
            disabled={loading}
            onClick={reload}
          />
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loadError && !info ? (
          <EmptyState
            variant="error"
            title={t('databaseInfo.loadFailed')}
            description={loadError.message}
            error={loadError}
            detailsLabel={t('common.details')}
            action={
              <Button variant="primary" icon={RefreshCw} onClick={reload}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : !info ? (
          <Skeleton variant="tile" count={6} />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <StatTile
                label={readOnly ? t('databaseInfo.keys') : t('databaseInfo.tables')}
                value={formatNumber(info.tableCount)}
              />
              <StatTile label={t('databaseInfo.rows')} value={formatNumber(info.rowEstimate)} />
              <StatTile label={t('databaseInfo.dataSize')} value={formatBytes(info.dataLength)} />
              <StatTile label={t('databaseInfo.indexSize')} value={formatBytes(info.indexLength)} />
              <StatTile label={t('databaseInfo.totalSize')} value={formatBytes(info.totalSize)} />
              <StatTile label={t('databaseInfo.freeSpace')} value={formatBytes(info.dataFree)} />
              <StatTile label={t('databaseInfo.charset')} value={info.charset || '-'} />
              <StatTile label={t('databaseInfo.collation')} value={info.collation || '-'} />
              <StatTile label={t('databaseInfo.owner')} value={info.owner || '-'} />
            </div>

            <Panel
              className="mt-3"
              header={t('databaseInfo.comment')}
              description={t('databaseInfo.visibleHint')}
            >
              <div className="rounded-md border border-border bg-inset p-3 text-sm break-words whitespace-pre-wrap">
                {info.comment || <span className="text-fg-muted">{t('databaseInfo.noComment')}</span>}
              </div>
            </Panel>

            {!readOnly && (
              <Panel
                className="mt-3"
                tone="danger"
                header={t('databaseInfo.dangerZone')}
                description={t('databaseInfo.dropDatabaseDescription', { database })}
                headerActions={
                  <Button
                    variant="danger"
                    icon={Trash2}
                    onClick={() => setConfirmingDrop(true)}
                    loading={deleting}
                    disabled={deleting}
                  >
                    {deleting ? t('databaseInfo.droppingDatabase') : t('databaseInfo.dropDatabase')}
                  </Button>
                }
              />
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmingDrop}
        onOpenChange={setConfirmingDrop}
        tone="danger"
        title={t('databaseInfo.confirmDropTitle')}
        body={t('sidebar.confirm.dropDatabase', { database })}
        subject={database}
        requireTypedConfirmation={database}
        typedConfirmationHint={t('sidebar.confirm.typeDatabaseToConfirm')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('databaseInfo.confirmDropAction')}
        onConfirm={dropCurrentDatabase}
      />
    </div>
  )
}
