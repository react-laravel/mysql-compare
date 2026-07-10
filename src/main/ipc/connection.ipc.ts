import { IPC } from '../../shared/ipc-channels'
import type { ConnectionConfig, DatabaseCredentialConfig } from '../../shared/types'
import { connectionStore } from '../store/connection-store'
import { dbService } from '../services/db-service'
import { handle } from './_wrap'

export function registerConnectionIPC(): void {
  handle(IPC.ConnectionList, () => connectionStore.list())

  handle(IPC.ConnectionUpsert, async (conn: ConnectionConfig) => {
    const saved = connectionStore.upsert(conn)
    await dbService.closeConnection(saved.id)
    return saved
  })

  handle(IPC.ConnectionDelete, async (id: string) => {
    connectionStore.remove(id)
    await dbService.closeConnection(id)
  })

  handle(IPC.ConnectionClose, async (id: string) => {
    await dbService.closeConnection(id)
  })

  handle(IPC.ConnectionSetDatabaseCredential, async (payload: {
    id: string
    database: string
    credential: DatabaseCredentialConfig
  }) => {
    const saved = connectionStore.setDatabaseCredential(payload.id, payload.database, payload.credential)
    await dbService.closeConnection(saved.id)
    return saved
  })

  handle(IPC.ConnectionTestDatabaseCredential, async (payload: {
    id: string
    database: string
    credential: DatabaseCredentialConfig
  }) => {
    const connection = connectionStore.resolveDatabaseCredentialTest(
      payload.id,
      payload.database,
      payload.credential
    )
    const message = await dbService.testConnection(connection)
    return { message }
  })

  handle(IPC.ConnectionTest, async (conn: ConnectionConfig) => {
    const resolved = connectionStore.resolveSecrets(conn)
    const message = await dbService.testConnection(resolved)
    return { message }
  })
}
