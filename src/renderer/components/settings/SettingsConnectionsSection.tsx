// Settings ▸ Connections — the canonical home for **Delete connection**.
//
// Blueprint §3.11: it used to sit in the edit dialog's footer next to Save
// (`ConnectionDialog.tsx:199-203`), which is exactly where a destructive action
// must not be. Editing still opens the sidebar's connection dialog; only the
// deletion moves.
import * as React from 'react'
import { Plus } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { ConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { EngineIcon } from '@renderer/components/icons/EngineIcon'
import { useI18n } from '@renderer/i18n'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useSidebarStore } from '@renderer/store/sidebar-store'
import { useUIStore } from '@renderer/store/ui-store'
import type { SafeConnection } from '../../../shared/types'

export function SettingsConnectionsSection({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const connections = useConnectionStore((state) => state.connections)
  const removeConnection = useConnectionStore((state) => state.remove)
  const setEditing = useSidebarStore((state) => state.setEditing)
  const setCreating = useSidebarStore((state) => state.setCreating)
  const closeConnectionDatabaseTabs = useUIStore((state) => state.closeConnectionDatabaseTabs)
  const showToast = useUIStore((state) => state.showToast)
  const [pendingDelete, setPendingDelete] = React.useState<SafeConnection | null>(null)

  const edit = (connection: SafeConnection) => {
    setEditing(connection)
    onClose()
  }

  const create = () => {
    setCreating(true)
    onClose()
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await removeConnection(pendingDelete.id)
      closeConnectionDatabaseTabs(pendingDelete.id)
      showToast(t('sidebar.toast.connectionDeleted'), 'success')
    } catch (error) {
      showToast((error as Error).message, 'error')
    }
  }

  if (connections.length === 0) {
    return (
      <EmptyState
        size="sm"
        variant="first-run"
        title={t('settings.connections.emptyTitle')}
        description={t('settings.connections.emptyDescription')}
        action={
          <Button icon={Plus} variant="primary" onClick={create}>
            {t('sidebar.newConnection')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1">
        {connections.map((connection) => (
          <li
            key={connection.id}
            className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5"
          >
            <EngineIcon engine={connection.engine} className="size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-fg">{connection.name}</div>
              <div className="truncate font-mono text-2xs text-fg-muted">
                {connection.username}@{connection.host}:{connection.port}
              </div>
            </div>
            {connection.useSSH ? (
              <Badge size="xs" tone="accent">
                SSH
              </Badge>
            ) : null}
            <Button size="xs" onClick={() => edit(connection)}>
              {t('common.edit')}
            </Button>
            <Button size="xs" variant="danger-ghost" onClick={() => setPendingDelete(connection)}>
              {t('common.delete')}
            </Button>
          </li>
        ))}
      </ul>

      <div>
        <Button icon={Plus} size="sm" onClick={create}>
          {t('sidebar.newConnection')}
        </Button>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        tone="danger"
        title={t('settings.connections.deleteTitle')}
        subject={pendingDelete?.name}
        consequence={t('settings.connections.deleteConsequence')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
