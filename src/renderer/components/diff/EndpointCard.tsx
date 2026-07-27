// Source / Target 端点选择卡片，被 DiffPanel 的 Compare setup 折叠区使用。
//
// Blueprint §3.5: a `Panel` with two `Field`s, so the label/control/hint wiring
// is the shared one instead of a hand-assembled `Label` + `div` pair.
import type { Ref } from 'react'
import { Badge } from '@renderer/components/ui/badge'
import { Field } from '@renderer/components/ui/field'
import { Panel } from '@renderer/components/ui/panel'
import { Select } from '@renderer/components/ui/select'
import { Spinner } from '@renderer/components/ui/spinner'
import { useI18n } from '@renderer/i18n'

type SelectOption = { value: string; label: string }

interface EndpointCardProps {
  role: 'source' | 'target'
  connectionName: string | undefined
  database: string
  connectionOptions: SelectOption[]
  connectionValue: string
  onConnectionChange: (value: string) => void
  databaseOptions: SelectOption[]
  databaseValue: string
  databaseDisabled: boolean
  databaseLoading: boolean
  onDatabaseChange: (value: string) => void
  /** the "Compare this database…" flow lands focus on the target connection */
  connectionRef?: Ref<HTMLSelectElement>
}

export function EndpointCard({
  role,
  connectionName,
  database,
  connectionOptions,
  connectionValue,
  onConnectionChange,
  databaseOptions,
  databaseValue,
  databaseDisabled,
  databaseLoading,
  onDatabaseChange,
  connectionRef
}: EndpointCardProps) {
  const { t } = useI18n()
  const roleLabel = role === 'source' ? t('diff.endpoint.source') : t('diff.endpoint.target')
  const summary = [connectionName, database].filter(Boolean).join(' / ')

  return (
    <Panel
      header={roleLabel}
      headerActions={
        summary ? (
          <Badge className="max-w-[16rem] overflow-hidden">
            <span className="truncate font-mono">{summary}</span>
          </Badge>
        ) : null
      }
    >
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 xl:items-start">
        <Field label={t('diff.endpoint.connection')}>
          <Select
            ref={connectionRef}
            size="sm"
            options={connectionOptions}
            value={connectionValue}
            onChange={(event) => onConnectionChange(event.target.value)}
          />
        </Field>
        <Field
          label={
            <span className="inline-flex items-center gap-1.5">
              {t('diff.endpoint.database')}
              {databaseLoading ? <Spinner size="xs" label={t('common.loading')} /> : null}
            </span>
          }
        >
          <Select
            size="sm"
            options={databaseOptions}
            value={databaseValue}
            disabled={databaseDisabled}
            onChange={(event) => onDatabaseChange(event.target.value)}
          />
        </Field>
      </div>
    </Panel>
  )
}
