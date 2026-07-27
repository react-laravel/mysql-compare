import { useEffect } from 'react'
import { AppShell } from '@renderer/components/layout/AppShell'
import { Toaster } from '@renderer/components/ui/toast'
import { useI18n } from '@renderer/i18n'
import { checkForUpdate } from '@renderer/lib/updater'

export default function App() {
  const { t } = useI18n()

  useEffect(() => {
    void checkForUpdate(t)
  }, [t])

  return (
    <>
      <AppShell />
      <Toaster dismissLabel={t('common.dismiss')} detailsLabel={t('common.details')} />
    </>
  )
}
