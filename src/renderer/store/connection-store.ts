// 连接状态管理：维护连接列表，并提供刷新方法。
import { create } from 'zustand'
import type { DatabaseCredentialConfig, SafeConnection } from '../../shared/types'
import { api, unwrap } from '../lib/api'

interface ConnectionState {
  connections: SafeConnection[]
  loading: boolean
  refresh: () => Promise<void>
  remove: (id: string) => Promise<void>
  close: (id: string) => Promise<void>
  setDatabaseCredential: (
    id: string,
    database: string,
    credential: DatabaseCredentialConfig
  ) => Promise<void>
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  connections: [],
  loading: false,
  refresh: async () => {
    set({ loading: true })
    try {
      const list = await unwrap(api.connection.list())
      set({ connections: list })
    } finally {
      set({ loading: false })
    }
  },
  remove: async (id) => {
    await unwrap(api.connection.remove(id))
    const list = await unwrap(api.connection.list())
    set({ connections: list })
  },
  close: async (id) => {
    await unwrap(api.connection.close(id))
  },
  setDatabaseCredential: async (id, database, credential) => {
    await unwrap(api.connection.setDatabaseCredential(id, database, credential))
    const list = await unwrap(api.connection.list())
    set({ connections: list })
  }
}))
