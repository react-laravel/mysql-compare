export const isTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const isElectronRenderer = () =>
  typeof window !== 'undefined' &&
  typeof window.api !== 'undefined' &&
  window.api.runtime?.mode === 'electron'

export const isWebRuntime = () => false
