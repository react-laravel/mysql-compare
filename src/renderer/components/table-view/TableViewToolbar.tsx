import { tableDisplayName } from '../../../shared/table-reference'
import type { ReactNode } from 'react'
import { Toolbar, type ToolbarProps } from '@renderer/components/ui/toolbar'

interface TableViewToolbarProps extends Omit<ToolbarProps, 'title' | 'subtitle' | 'center' | 'centerPosition'> {
  table: string
  database: string
  connectionName?: string
  engine?: string
  tabs?: ReactNode
}

/** All three table views share the same identity and anchored navigation. */
export function TableViewToolbar({ table, database, connectionName, engine = 'mysql', tabs, ...props }: TableViewToolbarProps) {
  const context = [connectionName, database].filter(Boolean).join(' / ')
  return (
    <Toolbar
      {...props}
      title={<span className="font-mono" title={tableDisplayName(table)}>{tableDisplayName(table)}</span>}
      subtitle={`${context} · ${engine}`}
      center={tabs}
      centerPosition="after-title"
    />
  )
}
