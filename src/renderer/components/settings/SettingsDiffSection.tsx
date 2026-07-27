import * as React from 'react'
import { Button } from '@renderer/components/ui/button'
import { Field } from '@renderer/components/ui/field'
import { Select } from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { useI18n } from '@renderer/i18n'
import {
  TABLE_COMPARE_CONCURRENCY_OPTIONS,
  useSettingsStore
} from '@renderer/store/settings-store'
import { SettingsRow } from './SettingsRow'
import { clearDiffEndpointHistory } from './storage-maintenance'

/**
 * The two controls demoted out of `DiffPanelToolbar.tsx:52-67` (blueprint §1.3:
 * configure-once-then-forget). They keep a `⌘K` command each and reappear in
 * the diff toolbar's `⋯` in Chunk 9.
 */
export function SettingsDiffSection() {
  const { t } = useI18n()
  const compareRows = useSettingsStore((state) => state.compareRows)
  const setCompareRows = useSettingsStore((state) => state.setCompareRows)
  const concurrency = useSettingsStore((state) => state.tableCompareConcurrency)
  const setConcurrency = useSettingsStore((state) => state.setTableCompareConcurrency)
  const [clearedPairs, setClearedPairs] = React.useState<number | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <Switch
        checked={compareRows}
        onCheckedChange={setCompareRows}
        label={t('settings.diff.compareRows')}
        description={t('settings.diff.compareRowsHint')}
      />

      <Field label={t('settings.diff.concurrency')} hint={t('settings.diff.concurrencyHint')}>
        <Select
          value={String(concurrency)}
          onChange={(event) => setConcurrency(Number.parseInt(event.target.value, 10))}
          containerClassName="max-w-40"
          options={TABLE_COMPARE_CONCURRENCY_OPTIONS.map((option) => ({
            value: String(option),
            label: String(option)
          }))}
        />
      </Field>

      <SettingsRow
        label={t('settings.diff.recentPairs')}
        hint={
          clearedPairs === null
            ? t('settings.diff.recentPairsHint')
            : t('settings.diff.recentPairsCleared', { count: clearedPairs })
        }
      >
        <div>
          <Button size="sm" onClick={() => setClearedPairs(clearDiffEndpointHistory())}>
            {t('settings.diff.clearRecentPairs')}
          </Button>
        </div>
      </SettingsRow>
    </div>
  )
}
