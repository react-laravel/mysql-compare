import { useId, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowDownAZ, Folder, Server } from 'lucide-react'
import { EngineIcon } from '@renderer/components/icons/EngineIcon'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Input } from '@renderer/components/ui/input'
import { useI18n } from '@renderer/i18n'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useSidebarActions } from '../layout/sidebar-actions'
import { groupConnections } from '../layout/sidebar-tree-rows'
import { connectionHostGroup, moveItem } from './connection-organization'

export function ConnectionOrganizationDialog() {
  const { t } = useI18n()
  const actions = useSidebarActions()
  const close = useSidebarStore((state) => state.setOrganizingConnections)
  const [draft, setDraft] = useState(() => useConnectionStore.getState().connections.map((c) => ({ ...c })))
  // Keep rows in place while typing so a group change cannot remove the input
  // or a neighbouring button before the user's click has finished.
  const [groupEdits, setGroupEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const suggestions = useId()
  const groups = groupConnections(draft, t('sidebar.organization.ungrouped'))
  const editedConnections = () => draft.map((connection) => ({
    ...connection, group: groupEdits[connection.id] ?? connection.group
  }))

  const save = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await actions.saveConnectionOrganization(groupConnections(editedConnections(), t('sidebar.organization.ungrouped')).flatMap((group) =>
        group.connections.map(({ id, group }) => ({ id, group }))
      ))
      close(false)
    } catch (error) {
      const message = (error as Error).message
      setError(message.includes('CONNECTION_LIST_CHANGED') ? t('sidebar.organization.listChanged') : message)
    } finally {
      setBusy(false)
    }
  }

  const sortNames = () => {
    const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    setDraft(groupConnections(editedConnections(), t('sidebar.organization.ungrouped')).sort((a, b) => compare(a.label, b.label)).flatMap((group) =>
      [...group.connections].sort((a, b) => compare(a.name, b.name) || compare(a.database ?? '', b.database ?? ''))
    ))
    setGroupEdits({})
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open && !busy) close(false) }}
      title={t('sidebar.organization.title')}
      description={t('sidebar.organization.description')}
      size="lg"
      dismissible={!busy}
      footer={<>
        <Button disabled={busy} onClick={() => close(false)}>{t('common.cancel')}</Button>
        <Button variant="primary" loading={busy} onClick={() => void save()}>{t('common.save')}</Button>
      </>}
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" icon={Server} disabled={busy} onClick={() => {
          setDraft((items) => items.map((connection) => ({ ...connection, group: connectionHostGroup(connection) })))
          setGroupEdits({})
        }}>{t('sidebar.organization.byHost')}</Button>
        <Button size="sm" icon={ArrowDownAZ} disabled={busy} onClick={sortNames}>{t('sidebar.organization.byName')}</Button>
      </div>
      <datalist id={suggestions}>
        {groups.filter((group) => group.connections[0]?.group?.trim()).map((group) =>
          <option key={group.key} value={group.label} />
        )}
      </datalist>
      <div className="flex flex-col gap-3">
        {groups.map((group, groupIndex) => (
          <section key={group.key} aria-label={group.label} className="rounded-lg border border-border">
            <div className="flex items-center gap-2 rounded-t-lg bg-surface-2 px-2 py-1">
              <Folder aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={group.label}>{group.label}</span>
              <span className="text-xs text-fg-muted">{group.connections.length}</span>
              <IconButton size="xs" icon={ArrowUp} label={t('sidebar.organization.groupUp', { name: group.label })} disabled={busy || groupIndex === 0}
                onClick={() => setDraft(moveItem(groups, groupIndex, -1).flatMap((entry) => entry.connections))} />
              <IconButton size="xs" icon={ArrowDown} label={t('sidebar.organization.groupDown', { name: group.label })} disabled={busy || groupIndex === groups.length - 1}
                onClick={() => setDraft(moveItem(groups, groupIndex, 1).flatMap((entry) => entry.connections))} />
            </div>
            {group.connections.map((connection, index) => {
              const label = `${connection.name} · ${connection.engine}${connection.database ? ` · ${connection.database}` : ''}`
              return (
                <div key={connection.id} className="flex flex-wrap items-center gap-2 border-t border-border px-2 py-2">
                  <EngineIcon engine={connection.engine} className="size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm" title={label}>{label}</div>
                    <div className="truncate text-xs text-fg-muted" title={`${connection.username}@${connection.host}:${connection.port}`}>
                      {connection.username}@{connection.host}:{connection.port}
                    </div>
                  </div>
                  <Input className="w-36" list={suggestions} disabled={busy} value={groupEdits[connection.id] ?? connection.group ?? ''}
                    aria-label={t('sidebar.organization.groupFor', { name: label })} placeholder={t('sidebar.organization.ungrouped')}
                    onChange={(event) => {
                      const value = event.target.value
                      setGroupEdits((edits) => ({ ...edits, [connection.id]: value }))
                    }} />
                  <IconButton size="xs" icon={ArrowUp} label={t('sidebar.organization.up', { name: label })} disabled={busy || index === 0}
                    onClick={() => setDraft(groups.flatMap((entry) => entry.key === group.key ? moveItem(entry.connections, index, -1) : entry.connections))} />
                  <IconButton size="xs" icon={ArrowDown} label={t('sidebar.organization.down', { name: label })} disabled={busy || index === group.connections.length - 1}
                    onClick={() => setDraft(groups.flatMap((entry) => entry.key === group.key ? moveItem(entry.connections, index, 1) : entry.connections))} />
                </div>
              )
            })}
          </section>
        ))}
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-danger-text">{error}</p> : null}
    </Dialog>
  )
}
