// `?` — the shortcut sheet, generated from the same registry the palette and
// the menus quote, so a binding can never be documented but unimplemented.
import { Dialog } from '@renderer/components/ui/dialog'
import { Kbd } from '@renderer/components/ui/kbd'
import { useI18n } from '@renderer/i18n'
import { useShell } from './shell-context'
import { SHORTCUTS, SHORTCUT_GROUPS } from './shortcut-registry'

export function ShortcutHelpDialog() {
  const { t } = useI18n()
  const shell = useShell()

  return (
    <Dialog
      open={shell.shortcutHelpOpen}
      onOpenChange={shell.setShortcutHelpOpen}
      size="lg"
      title={t('shortcuts.title')}
      description={t('shortcuts.description')}
    >
      <div className="flex flex-col gap-4">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group} className="flex flex-col gap-1">
            <h3 className="text-xs font-medium uppercase text-fg-subtle">
              {t(`shortcuts.groups.${group}`)}
            </h3>
            <dl className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1">
              {SHORTCUTS.filter((entry) => entry.group === group).map((entry) => (
                <div key={entry.id} className="contents">
                  <dt className="truncate text-sm text-fg">{t(`shortcuts.keys.${entry.labelKey}`)}</dt>
                  <dd className="flex items-center gap-1">
                    {entry.chords.map((chord) => (
                      <Kbd key={chord}>{chord}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
