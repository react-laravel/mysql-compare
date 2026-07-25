import type { AppAPI } from '../../shared/app-api'
import type { IPCResult } from '../../shared/types'
import { createTauriApi, isTauriRuntime } from './tauri-api'

declare global {
  interface Window {
    api: AppAPI
  }
}

function unresolvedApi(): AppAPI {
  return new Proxy({} as AppAPI, {
    get(_target, prop) {
      if (prop === 'runtime') {
        return {
          mode: 'tauri' as const,
          supportsNativeFilePicker: true,
          supportsDirectoryUpload: true,
          supportsTerminalStreaming: true,
          supportsDownload: true
        }
      }
      if (typeof window !== 'undefined' && window.api) {
        return Reflect.get(window.api, prop)
      }
      return () => {
        throw new Error('App API is not ready yet')
      }
    }
  })
}

export const api: AppAPI = unresolvedApi()

export async function bootstrapApi(): Promise<AppAPI> {
  if (!isTauriRuntime()) {
    throw new Error('MySQL Compare desktop requires the Tauri runtime')
  }
  const tauriApi = createTauriApi()
  window.api = tauriApi
  return tauriApi
}

export async function unwrap<T>(p: Promise<IPCResult<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(r.error || 'IPC error')
  return r.data as T
}
