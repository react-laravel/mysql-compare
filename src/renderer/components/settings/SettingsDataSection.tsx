// Settings ▸ Data & storage — the only UI that can clear the app's localStorage
// namespaces. Every one of them was previously write-only (blueprint §3.11).
import * as React from 'react'
import { Button } from '@renderer/components/ui/button'
import { ConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { useI18n } from '@renderer/i18n'
import { SettingsRow } from './SettingsRow'
import { clearSQLHistory, resetLayout } from './storage-maintenance'

type PendingAction = 'sql-history' | 'layout'

export function SettingsDataSection() {
  const { t } = useI18n()
  const [pending, setPending] = React.useState<PendingAction | null>(null)
  const [result, setResult] = React.useState<Partial<Record<PendingAction, number>>>({})

  const run = () => {
    if (!pending) return
    const removed = pending === 'sql-history' ? clearSQLHistory() : resetLayout()
    setResult((current) => ({ ...current, [pending]: removed }))
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsRow
        label={t('settings.data.sqlHistory')}
        hint={
          result['sql-history'] === undefined
            ? t('settings.data.sqlHistoryHint')
            : t('settings.data.sqlHistoryCleared', { count: result['sql-history'] })
        }
      >
        <div>
          <Button size="sm" variant="danger-ghost" onClick={() => setPending('sql-history')}>
            {t('settings.data.clearSqlHistory')}
          </Button>
        </div>
      </SettingsRow>

      <SettingsRow
        label={t('settings.data.layout')}
        hint={
          result.layout === undefined
            ? t('settings.data.layoutHint')
            : t('settings.data.layoutReset')
        }
      >
        <div>
          <Button size="sm" variant="danger-ghost" onClick={() => setPending('layout')}>
            {t('settings.data.resetLayout')}
          </Button>
        </div>
      </SettingsRow>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        tone="danger"
        title={
          pending === 'layout'
            ? t('settings.data.resetLayout')
            : t('settings.data.clearSqlHistory')
        }
        body={
          pending === 'layout' ? t('settings.data.layoutConfirm') : t('settings.data.sqlHistoryConfirm')
        }
        consequence={t('settings.data.irreversible')}
        confirmLabel={t('common.confirmExecute')}
        cancelLabel={t('common.cancel')}
        onConfirm={run}
      />
    </div>
  )
}
