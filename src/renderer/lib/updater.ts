import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { toast } from '@renderer/store/toast-store'
import type { Translator } from '@renderer/i18n'

const UPDATE_TOAST_ID = 'app-update'
let startupCheck: Promise<Update | null> | null = null

async function installUpdate(update: Update, t: Translator): Promise<void> {
  let downloaded = 0
  let total = 0

  toast.show({
    id: UPDATE_TOAST_ID,
    title: t('updater.downloading'),
    durationMs: null,
  })

  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? 0
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength
      const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0
      toast.update(UPDATE_TOAST_ID, {
        title: `${t('updater.downloading')} ${percent}%`,
        action: undefined,
      })
    } else if (event.event === 'Finished') {
      toast.update(UPDATE_TOAST_ID, {
        title: t('updater.installing'),
        tone: 'success',
        action: undefined,
      })
    }
  })

  await relaunch()
}

async function runStartupCheck(t: Translator): Promise<Update | null> {
  let update: Update | null
  try {
    update = await check()
  } catch {
    return null
  }
  if (!update) return null

  toast.show({
    id: UPDATE_TOAST_ID,
    title: t('updater.available', { version: update.version }),
    durationMs: null,
    action: {
      label: t('updater.installNow'),
      onClick: () => {
        void installUpdate(update, t).catch((error) => {
          toast.update(UPDATE_TOAST_ID, {
            title: t('updater.failed'),
            tone: 'danger',
            details: error instanceof Error ? error.message : String(error),
            action: undefined,
          })
        })
      },
    },
  })
  return update
}

export function checkForUpdate(t: Translator): Promise<Update | null> {
  startupCheck ??= runStartupCheck(t)
  return startupCheck
}
