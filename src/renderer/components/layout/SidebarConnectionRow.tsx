import type { MouseEvent } from 'react'
import { ChevronDown, ChevronRight, Folder, Pencil, SquareTerminal } from 'lucide-react'
import { EngineIcon } from '@renderer/components/icons/EngineIcon'
import { useI18n } from '@renderer/i18n'
import type { SafeConnection } from '../../../shared/types'

interface SidebarConnectionRowProps {
  connection: SafeConnection
  expanded: boolean
  onToggle: (connection: SafeConnection) => void | Promise<void>
  onEdit: (connection: SafeConnection) => void
  onOpenSSHFiles: (connection: SafeConnection) => void
  onOpenSSHTerminal: (connection: SafeConnection) => void | Promise<void>
  onOpenMenu: (event: MouseEvent<HTMLDivElement>, connection: SafeConnection) => void
}


export function SidebarConnectionRow({
  connection,
  expanded,
  onToggle,
  onEdit,
  onOpenSSHFiles,
  onOpenSSHTerminal,
  onOpenMenu
}: SidebarConnectionRowProps) {
  const { t } = useI18n()

  return (
    <div
      className="group mx-1 flex cursor-pointer items-center rounded-md px-2 py-1 hover:bg-accent focus-within:bg-accent/70"
      onContextMenu={(event) => onOpenMenu(event, connection)}
    >
      <button
        onClick={() => onToggle(connection)}
        aria-expanded={expanded}
        className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <EngineIcon engine={connection.engine} className="h-3.5 w-3.5" />
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className="truncate">{connection.name}</span>
          {connection.useSSH && <span className="text-[9px] text-amber-400">SSH</span>}
        </span>
      </button>
      <div className="flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        {connection.useSSH && (
          <>
            <button
              onClick={(event) => {
                event.stopPropagation()
                onOpenSSHFiles(connection)
              }}
              className="p-1 text-muted-foreground hover:text-foreground"
              title={t('sidebar.openSshFiles')}
            >
              <Folder className="h-3 w-3" />
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation()
                void onOpenSSHTerminal(connection)
              }}
              className="p-1 text-muted-foreground hover:text-foreground"
              title={t('sidebar.openSshTerminal')}
            >
              <SquareTerminal className="h-3 w-3" />
            </button>
          </>
        )}
        <button
          onClick={() => onEdit(connection)}
          className="p-1 text-muted-foreground hover:text-foreground"
          title={t('common.edit')}
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
