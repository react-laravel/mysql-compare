import { Moon, Sun } from 'lucide-react'
import { RadioGroup } from '@renderer/components/ui/radio-group'
import { Switch } from '@renderer/components/ui/switch'
import { useI18n } from '@renderer/i18n'
import { useSettingsStore, type GridDensity } from '@renderer/store/settings-store'
import { useTheme, type Theme } from '@renderer/theme'
import { SettingsRow } from './SettingsRow'

/**
 * Theme is read from `theme/index.ts`, NOT from `settings-store` — the theme
 * store owns the `dark` class on `<html>` and a second copy would desynchronise
 * it the moment either one is written directly.
 */
export function SettingsAppearanceSection() {
  const { t } = useI18n()
  const { theme, setTheme } = useTheme()
  const density = useSettingsStore((state) => state.density)
  const setDensity = useSettingsStore((state) => state.setDensity)
  const colorblindDiff = useSettingsStore((state) => state.colorblindDiff)
  const setColorblindDiff = useSettingsStore((state) => state.setColorblindDiff)

  return (
    <div className="flex flex-col gap-4">
      <SettingsRow label={t('theme.label')}>
        <RadioGroup<Theme>
          name="settings-theme"
          variant="segmented"
          aria-label={t('theme.label')}
          value={theme}
          onValueChange={setTheme}
          options={[
            { value: 'light', label: t('theme.light'), icon: Sun },
            { value: 'dark', label: t('theme.dark'), icon: Moon }
          ]}
        />
      </SettingsRow>

      <SettingsRow
        label={t('settings.appearance.density')}
        hint={t('settings.appearance.densityHint')}
      >
        <RadioGroup<GridDensity>
          name="settings-density"
          variant="segmented"
          aria-label={t('settings.appearance.density')}
          value={density}
          onValueChange={setDensity}
          options={[
            { value: 'compact', label: t('settings.appearance.densityCompact') },
            { value: 'comfortable', label: t('settings.appearance.densityComfortable') }
          ]}
        />
      </SettingsRow>

      <Switch
        checked={colorblindDiff}
        onCheckedChange={setColorblindDiff}
        label={t('settings.appearance.colorblindDiff')}
        description={t('settings.appearance.colorblindDiffHint')}
      />
    </div>
  )
}
