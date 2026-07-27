import { AppShell } from '@renderer/components/layout/AppShell'
import { Toaster } from '@renderer/components/ui/toast'
import { useI18n } from '@renderer/i18n'

export default function App() {
  const { t } = useI18n()

  return (
    <>
      <AppShell />
      <Toaster dismissLabel={t('common.dismiss')} detailsLabel={t('common.details')} />
    </>
  )
}
