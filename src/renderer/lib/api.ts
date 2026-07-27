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
      if (typeof window !== 'undefined' && window.api) {
        return Reflect.get(window.api, prop)
      }
      // Before `bootstrapApi()` resolves, assume the desktop runtime — the
      // installed API (Tauri or dev mock) reports its own capabilities.
      if (prop === 'runtime') {
        return {
          mode: 'tauri' as const,
          supportsNativeFilePicker: true,
          supportsDirectoryUpload: true,
          supportsTerminalStreaming: true,
          supportsDownload: true
        }
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
    // `npm run dev:ui` serves the renderer in a plain browser, where the Tauri
    // IPC bridge does not exist. Install the dev mock instead of throwing, so
    // the UI is visually verifiable outside a full `tauri dev` build.
    if (import.meta.env.DEV) {
      const { createMockApi } = await import('./dev-mock-api')
      const mockApi = createMockApi()
      window.api = mockApi
      return mockApi
    }
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
