// Compare setup：源/目标端点 + 最近使用的对比组合。
//
// Blueprint §3.5: a collapsible `Panel` (auto-collapsed after the first
// compare) holding two endpoint `Panel`s and a "Recent pairs" `Combobox`. The
// hand-rolled history list — a row of `<button>` + `IconButton` pairs inside a
// dashed box — is gone; the pair a user picks is now searchable, and the one
// they no longer want is removed from beside the picker.
import type { Ref } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Combobox } from '@renderer/components/ui/combobox'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Panel } from '@renderer/components/ui/panel'
import { useI18n } from '@renderer/i18n'
import { EndpointCard } from './EndpointCard'

type SelectOption = { value: string; label: string }

interface EndpointSelectionProps {
  connectionName?: string
  database: string
  connectionOptions: SelectOption[]
  connectionValue: string
  onConnectionChange: (value: string) => void
  databaseOptions: SelectOption[]
  databaseValue: string
  databaseDisabled: boolean
  databaseLoading: boolean
  onDatabaseChange: (value: string) => void
}

interface DiffPanelSetupSectionProps {
  expanded: boolean
  summary: string
  onToggle: () => void
  history: {
    items: SelectOption[]
    activeValue: string
    onSelect: (value: string) => void
    onDelete: (value: string) => void
  }
  source: EndpointSelectionProps
  target: EndpointSelectionProps
  /** focused by the "Compare this database…" entrance, which prefills the source */
  targetConnectionRef?: Ref<HTMLSelectElement>
}

export function DiffPanelSetupSection({
  expanded,
  summary,
  onToggle,
  history,
  source,
  target,
  targetConnectionRef
}: DiffPanelSetupSectionProps) {
  const { t } = useI18n()
  const selectedHistoryItem =
    history.items.find((option) => option.value === history.activeValue) ?? null

  return (
    <Panel
      header={t('diff.setup.title')}
      // Collapsed, the summary *is* the setup; expanded it only repeats what the
      // two endpoint cards and the toolbar subtitle already say.
      description={expanded ? undefined : summary}
      headerActions={
        <Button
          size="sm"
          variant="ghost"
          icon={expanded ? ChevronDown : ChevronRight}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? t('diff.setup.hide') : t('diff.setup.show')}
        </Button>
      }
    >
      {expanded ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(15rem,20rem)]">
          <EndpointCard
            role="source"
            connectionName={source.connectionName}
            database={source.database}
            connectionOptions={source.connectionOptions}
            connectionValue={source.connectionValue}
            onConnectionChange={source.onConnectionChange}
            databaseOptions={source.databaseOptions}
            databaseValue={source.databaseValue}
            databaseDisabled={source.databaseDisabled}
            databaseLoading={source.databaseLoading}
            onDatabaseChange={source.onDatabaseChange}
          />

          <EndpointCard
            role="target"
            connectionName={target.connectionName}
            database={target.database}
            connectionOptions={target.connectionOptions}
            connectionValue={target.connectionValue}
            onConnectionChange={target.onConnectionChange}
            databaseOptions={target.databaseOptions}
            databaseValue={target.databaseValue}
            databaseDisabled={target.databaseDisabled}
            databaseLoading={target.databaseLoading}
            onDatabaseChange={target.onDatabaseChange}
            connectionRef={targetConnectionRef}
          />

          <Panel
            header={t('diff.history.label')}
            headerActions={history.items.length > 0 ? <Badge>{history.items.length}</Badge> : null}
          >
            <div className="flex items-center gap-1">
              <Combobox<SelectOption>
                className="min-w-0 flex-1"
                size="sm"
                items={history.items}
                value={selectedHistoryItem}
                onValueChange={(item) => {
                  if (item) history.onSelect(item.value)
                }}
                itemKey={(item) => item.value}
                itemLabel={(item) => item.label}
                placeholder={t('diff.history.placeholder')}
                searchPlaceholder={t('diff.history.placeholder')}
                emptyMessage={t('diff.history.empty')}
                aria-label={t('diff.history.label')}
                disabled={history.items.length === 0}
              />
              <IconButton
                icon={Trash2}
                label={t('diff.history.remove')}
                size="sm"
                variant="ghost"
                disabled={!selectedHistoryItem}
                onClick={() => {
                  if (selectedHistoryItem) history.onDelete(selectedHistoryItem.value)
                }}
              />
            </div>
            {history.items.length === 0 ? (
              <p className="mt-2 text-xs text-fg-muted">{t('diff.history.empty')}</p>
            ) : null}
          </Panel>
        </div>
      ) : null}
    </Panel>
  )
}
