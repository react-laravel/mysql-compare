// "Compare with…" — the second entrance to the table compare (blueprint §2.4).
//
// Before, the only way to reach a side-by-side table compare was
// Diff → run a whole-database comparison → Status tab → pick a card →
// "Open compare": four levels for "show me this table next to that one". This
// dialog is the direct route from a table row's `⋯` (and from `⌘K`), and it
// lands on the *same* `table-compare` tab id the diff panel produces.
import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { Select } from '@renderer/components/ui/select'
import { Spinner } from '@renderer/components/ui/spinner'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import { useDatabaseList } from './diff-panel-hooks'
import { buildDatabaseOptions } from './diff-panel-formatters'
import { buildTableCompareView } from './table-compare-session'

export function TableCompareTargetDialog() {
  const { t } = useI18n()
  const request = useSidebarStore((state) => state.tableCompareTargetDialog)
  const setRequest = useSidebarStore((state) => state.setTableCompareTargetDialog)
  const connections = useConnectionStore((state) => state.connections)
  const setRightView = useUIStore((state) => state.setRightView)
  const showToast = useUIStore((state) => state.showToast)

  const [targetConnectionId, setTargetConnectionId] = useState('')
  const [targetDatabase, setTargetDatabase] = useState('')
  const { databases, loading } = useDatabaseList(targetConnectionId, showToast)

  // Redis has no side-by-side table model, so it is not a compare endpoint.
  const connectionOptions = useMemo(
    () => [
      { value: '', label: t('diff.databaseOption.placeholder') },
      ...connections
        .filter((connection) => connection.engine !== 'redis')
        .map((connection) => ({ value: connection.id, label: connection.name }))
    ],
    [connections, t]
  )
  const databaseOptions = useMemo(
    () => buildDatabaseOptions(targetConnectionId, databases, loading, t),
    [databases, loading, t, targetConnectionId]
  )

  // Opening the dialog seeds the target with the source connection, because
  // "the same table in another database on this server" is the common case.
  useEffect(() => {
    if (!request) return
    setTargetConnectionId(request.connection.id)
    setTargetDatabase('')
  }, [request])

  if (!request) return null

  const sameEndpoint =
    targetConnectionId === request.connection.id && targetDatabase === request.database
  const canCompare = Boolean(targetConnectionId && targetDatabase) && !sameEndpoint

  const submit = () => {
    if (!canCompare) return
    setRightView(
      buildTableCompareView({
        sourceConnectionId: request.connection.id,
        sourceDatabase: request.database,
        targetConnectionId,
        targetDatabase,
        table: request.table
      })
    )
    setRequest(null)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) setRequest(null)
      }}
      size="md"
      title={t('diff.compareTarget.title', { table: request.table })}
      description={t('diff.compareTarget.description')}
      footer={
        <>
          <Button variant="secondary" onClick={() => setRequest(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon={ArrowRightLeft} disabled={!canCompare} onClick={submit}>
            {t('diff.compareTarget.compare')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('diff.endpoint.source')}>
          <p className="rounded-md border border-border bg-inset p-2 font-mono text-xs break-all text-fg">
            {request.connection.name} / {request.database} / {request.table}
          </p>
        </Field>
        <Field
          label={t('diff.endpoint.connection')}
          hint={sameEndpoint ? undefined : t('diff.compareTarget.targetHint')}
          error={sameEndpoint ? t('diff.compareTarget.sameEndpoint') : undefined}
        >
          <Select
            options={connectionOptions}
            value={targetConnectionId}
            onChange={(event) => {
              setTargetConnectionId(event.target.value)
              setTargetDatabase('')
            }}
          />
        </Field>
        <Field
          label={
            <span className="inline-flex items-center gap-1.5">
              {t('diff.endpoint.database')}
              {loading ? <Spinner size="xs" label={t('common.loading')} /> : null}
            </span>
          }
        >
          <Select
            options={databaseOptions}
            value={targetDatabase}
            disabled={!targetConnectionId || loading}
            onChange={(event) => setTargetDatabase(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  )
}
