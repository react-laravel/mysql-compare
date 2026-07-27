// How a workspace tab presents itself: title + glyph.
//
// Both were duplicated inside `Workspace.tsx` (the tab strip's icon switch and
// the quick switcher's near-identical copy). The shell needs the same mapping
// for the command palette's "Open" group, so it lives here — one source, three
// consumers (tab strip, palette, status bar).
import {
  Database as DatabaseIcon,
  Download,
  FileCode2,
  Folder,
  GitCompareArrows,
  SquareTerminal,
  Table as TableIcon,
  type LucideIcon
} from 'lucide-react'
import type { Translator } from '@renderer/i18n'
import type { RightView, WorkspaceView } from '@renderer/store/ui-store'
import type { DbEngine } from '../../shared/types'

export function getTabDisplayTitle(view: WorkspaceView, t: Translator): string {
  if (view.kind === 'diff') return t('app.diffSync')
  if (view.kind === 'database') {
    const prefix = t('workspace.tabTitle.databasePrefix')
    return view.connectionName
      ? `${prefix} · ${view.database} @ ${view.connectionName}`
      : `${prefix} · ${view.database}`
  }
  if (view.kind === 'sql') {
    const prefix = t('workspace.tabTitle.sqlPrefix')
    return view.connectionName
      ? `${prefix} · ${view.database} @ ${view.connectionName}`
      : `${prefix} · ${view.database}`
  }
  if (view.kind === 'database-export') {
    const prefix = t('workspace.tabTitle.databaseExportPrefix')
    return view.connectionName
      ? `${prefix} · ${view.request.database} @ ${view.connectionName}`
      : `${prefix} · ${view.request.database}`
  }
  if (view.kind === 'table-compare') {
    return `${t('workspace.tabTitle.comparePrefix')} · ${view.table}`
  }
  if (view.kind === 'ssh-files') {
    return `${t('workspace.tabTitle.sshFilesPrefix')} · ${view.connectionName}`
  }
  if (view.kind === 'ssh-terminal') {
    return `${t('workspace.tabTitle.sshTerminalPrefix')} · ${view.connectionName}`
  }
  if (view.kind === 'ssh-editor') {
    const leaf = view.path.split('/').filter(Boolean).pop() ?? view.path
    return `${t('workspace.tabTitle.sshEditorPrefix')} · ${leaf}`
  }
  return `${view.database} / ${view.table}`
}

export function getTabIcon(view: WorkspaceView): LucideIcon {
  switch (view.kind) {
    case 'diff':
    case 'table-compare':
      return GitCompareArrows
    case 'database':
      return DatabaseIcon
    case 'sql':
    case 'ssh-editor':
      return FileCode2
    case 'database-export':
      return Download
    case 'ssh-terminal':
      return SquareTerminal
    case 'ssh-files':
      return Folder
    default:
      return TableIcon
  }
}

export interface ViewContext {
  connectionId: string
  connectionName?: string
  database: string
  engine?: DbEngine
}

/**
 * The connection/database a view is "about", when it has one. Drives the status
 * bar's context slot and the titlebar's "New SQL console" enablement.
 */
export function getViewContext(view: RightView): ViewContext | null {
  switch (view.kind) {
    case 'table':
    case 'database':
    case 'sql':
      return {
        connectionId: view.connectionId,
        connectionName: view.kind === 'table' ? undefined : view.connectionName,
        database: view.database,
        engine: view.engine
      }
    case 'database-export':
      return {
        connectionId: view.request.connectionId,
        connectionName: view.connectionName,
        database: view.request.database
      }
    case 'table-compare':
      return {
        connectionId: view.sourceConnectionId,
        database: view.sourceDatabase
      }
    default:
      return null
  }
}
