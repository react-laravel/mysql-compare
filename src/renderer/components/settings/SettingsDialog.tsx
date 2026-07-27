// ⌘, — Settings (blueprint §3.11).
//
// DESIGN-SYSTEM §9 rule 2: setup lives in Settings, never in the nav. This is
// where the theme control and the language picker land after `SidebarAppMenu`
// is dissolved, and where the toolbar controls demoted in §1.3 are configured.
// It is a Dialog, not a tab and not a nav slot.
import { useI18n } from '@renderer/i18n'
import { Dialog } from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/utils'
import { useShell, type SettingsSectionId } from '@renderer/components/layout/shell-context'
import { SettingsAppearanceSection } from './SettingsAppearanceSection'
import { SettingsConnectionsSection } from './SettingsConnectionsSection'
import { SettingsDataSection } from './SettingsDataSection'
import { SettingsDiffSection } from './SettingsDiffSection'
import { SettingsGridSection } from './SettingsGridSection'
import { SettingsLanguageSection } from './SettingsLanguageSection'

const SECTIONS: SettingsSectionId[] = [
  'appearance',
  'language',
  'connections',
  'grid',
  'diff',
  'data'
]

export function SettingsDialog() {
  const { t } = useI18n()
  const shell = useShell()

  const close = () => shell.setSettingsOpen(false)

  return (
    <Dialog
      open={shell.settingsOpen}
      onOpenChange={shell.setSettingsOpen}
      size="lg"
      title={t('settings.title')}
      description={t('settings.description')}
    >
      <div className="flex min-h-72 gap-4">
        <nav aria-label={t('settings.title')} className="w-40 shrink-0">
          <ul className="flex flex-col gap-0.5">
            {SECTIONS.map((section) => {
              const active = section === shell.settingsSection
              return (
                <li key={section}>
                  <button
                    type="button"
                    aria-current={active || undefined}
                    onClick={() => shell.openSettings(section)}
                    className={cn(
                      'flex h-control-md w-full items-center rounded-md px-2 text-left text-sm',
                      active
                        ? 'bg-selected font-medium text-fg'
                        : 'text-fg-muted hover:bg-hover hover:text-fg'
                    )}
                  >
                    {t(`settings.sections.${section}`)}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 border-l border-border pl-4">
          {shell.settingsSection === 'appearance' ? <SettingsAppearanceSection /> : null}
          {shell.settingsSection === 'language' ? <SettingsLanguageSection /> : null}
          {shell.settingsSection === 'connections' ? (
            <SettingsConnectionsSection onClose={close} />
          ) : null}
          {shell.settingsSection === 'grid' ? <SettingsGridSection /> : null}
          {shell.settingsSection === 'diff' ? <SettingsDiffSection /> : null}
          {shell.settingsSection === 'data' ? <SettingsDataSection /> : null}
        </div>
      </div>
    </Dialog>
  )
}
