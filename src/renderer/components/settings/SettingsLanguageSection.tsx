import { Field } from '@renderer/components/ui/field'
import { Select } from '@renderer/components/ui/select'
import { LOCALES, useI18n, type Locale } from '@renderer/i18n'

/**
 * Locale lives in `i18n/index.ts`, not in `settings-store` — same reason as the
 * theme: it already owns its own persisted store.
 */
export function SettingsLanguageSection() {
  const { locale, setLocale, t } = useI18n()

  return (
    <div className="flex flex-col gap-4">
      <Field label={t('language.label')} hint={t('settings.language.hint')}>
        <Select
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
          options={LOCALES.map((option) => ({ value: option.code, label: option.label }))}
        />
      </Field>
    </div>
  )
}
