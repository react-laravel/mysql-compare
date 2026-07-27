// ⌘K. Wires the app's command registry into the shared `CommandPalette`.
import { CommandPalette, type CommandGroup } from '@renderer/components/ui/command-palette'
import { useI18n } from '@renderer/i18n'
import { useShell } from './shell-context'
import { useCommands } from './useCommands'

export function AppCommandPalette() {
  const { t } = useI18n()
  const shell = useShell()
  const commands = useCommands()

  const groupLabels: Record<CommandGroup, string> = {
    navigate: t('palette.groups.navigate'),
    action: t('palette.groups.action'),
    open: t('palette.groups.open'),
    settings: t('palette.groups.settings')
  }

  return (
    <CommandPalette
      open={shell.commandPaletteOpen}
      onOpenChange={shell.setCommandPaletteOpen}
      commands={commands}
      placeholder={t('palette.placeholder')}
      emptyMessage={t('palette.empty')}
      groupLabels={groupLabels}
      footer={t('palette.hint')}
      aria-label={t('palette.title')}
    />
  )
}
