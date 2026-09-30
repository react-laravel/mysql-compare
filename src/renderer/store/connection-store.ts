// 连接状态管理：维护连接列表，并提供刷新方法。
import { create } from 'zustand'
import type { ConnectionOrganizationItem, DatabaseCredentialConfig, SafeConnection } from '../../shared/types'
import { api, unwrap } from '../lib/api'

interface ConnectionState {
  connections: SafeConnection[]
  loading: boolean
  refresh: () => Promise<void>
  organize: (items: ConnectionOrganizationItem[]) => Promise<void>
  updateDatabaseBrowsing: (id: string, options: { database?: string; showAll?: boolean; credential?: DatabaseCredentialConfig }) => Promise<SafeConnection>
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
  updateDatabaseBrowsing: async (id, options) => {
    const connection = await unwrap(api.connection.updateDatabaseBrowsing(id, options))
    set((state) => ({ connections: state.connections.map((item) => item.id === id ? connection : item) }))
    return connection
  },
  organize: async (items) => {
    const connections = await unwrap(api.connection.organize(items))
    set({ connections })
  },
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
