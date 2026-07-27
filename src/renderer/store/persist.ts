// Shared plumbing for the persisted Zustand stores (`ui-store`, `settings-store`,
// `sidebar-store`).
//
// `createJSONStorage(() => localStorage)` swallows the ReferenceError in a
// non-browser environment and hands `persist` an `undefined` storage, which then
// warns on every write. The unit tests run under `environment: 'node'`, so that
// is the common case, not the exotic one — hence an explicit in-memory fallback.
import { createJSONStorage, type PersistStorage } from 'zustand/middleware'

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => {
      map.delete(key)
    },
    setItem: (key, value) => {
      map.set(key, value)
    }
  }
}

const memoryStorage = createMemoryStorage()

function resolveStorage(): Storage {
  if (typeof window === 'undefined') return memoryStorage
  try {
    // Touch it — Safari private mode throws on access, not on use.
    window.localStorage.getItem('__probe__')
    return window.localStorage
  } catch {
    return memoryStorage
  }
}

/** `createJSONStorage`, minus the "storage is currently unavailable" warnings. */
export function safeJSONStorage<T>(): PersistStorage<T> | undefined {
  return createJSONStorage<T>(resolveStorage)
}

/** Reads a legacy standalone localStorage key so a migrated store keeps its value. */
export function readLegacyKey(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
