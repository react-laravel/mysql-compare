import type { ConnectionConfig } from '../../../shared/types'
import type { DbDriver } from './types'
import { MySQLDriver } from './mysql-driver'
import { PostgresDriver } from './pg-driver'
import { RedisDriver } from './redis-driver'

export function createDriver(params: {
  connection: ConnectionConfig
  localPort?: number
}): DbDriver {
  switch (params.connection.engine) {
    case 'redis':
      return new RedisDriver(params)
    case 'postgres':
      return new PostgresDriver(params)
    case 'mysql':
    default:
      return new MySQLDriver(params)
  }
}
