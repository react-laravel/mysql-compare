import type { ReactNode } from 'react'
import { Tabs } from '@renderer/components/ui/tabs'

interface DiffPanelResultContainerProps<T extends string> {
  resultTab: T
  tabItems: { value: T; label: ReactNode }[]
  onResultTabChange: (value: T) => void
  tabListLabel: string
  children: ReactNode
}

export function DiffPanelResultContainer<T extends string>({
  resultTab,
  tabItems,
  onResultTabChange,
  tabListLabel,
  children
}: DiffPanelResultContainerProps<T>) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-surface">
      <Tabs
        aria-label={tabListLabel}
        className="px-3"
        size="sm"
        value={resultTab}
        onValueChange={(value) => onResultTabChange(value as T)}
        items={tabItems}
      />
      <div className="flex min-w-0 flex-1 flex-col p-3">{children}</div>
    </div>
  )
}