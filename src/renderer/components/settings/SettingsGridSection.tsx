import * as React from 'react'
import { Button } from '@renderer/components/ui/button'
import { Field } from '@renderer/components/ui/field'
import { Select } from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { useI18n } from '@renderer/i18n'
import { PAGE_SIZE_OPTIONS, useSettingsStore } from '@renderer/store/settings-store'
import { SettingsRow } from './SettingsRow'
import { clearHiddenColumns } from './storage-maintenance'

export function SettingsGridSection() {
  const { t } = useI18n()
  const defaultPageSize = useSettingsStore((state) => state.defaultPageSize)
  const setDefaultPageSize = useSettingsStore((state) => state.setDefaultPageSize)
  const wrapCells = useSettingsStore((state) => state.wrapCells)
  const setWrapCells = useSettingsStore((state) => state.setWrapCells)
  const [resetCount, setResetCount] = React.useState<number | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <Field label={t('settings.grid.pageSize')} hint={t('settings.grid.appliesToNewTabs')}>
        <Select
          value={String(defaultPageSize)}
          onChange={(event) => setDefaultPageSize(Number.parseInt(event.target.value, 10))}
          containerClassName="max-w-40"
          options={PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: String(size) }))}
        />
      </Field>

      <Switch
        checked={wrapCells}
        onCheckedChange={setWrapCells}
        label={t('settings.grid.wrapCells')}
        description={t('settings.grid.appliesToNewTabs')}
      />

      <SettingsRow
        label={t('settings.grid.hiddenColumns')}
        hint={
          resetCount === null
            ? t('settings.grid.hiddenColumnsHint')
            : t('settings.grid.hiddenColumnsCleared', { count: resetCount })
        }
      >
        <div>
          <Button size="sm" onClick={() => setResetCount(clearHiddenColumns())}>
            {t('settings.grid.resetHiddenColumns')}
          </Button>
        </div>
      </SettingsRow>
    </div>
  )
}
