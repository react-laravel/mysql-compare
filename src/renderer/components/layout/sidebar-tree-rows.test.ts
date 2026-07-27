import { describe, expect, it } from 'vitest'
import { REDIS_MAX_LISTED_KEYS } from '../../../shared/constants'
import type { SafeConnection } from '../../../shared/types'
import { buildSidebarRows, groupConnections } from './sidebar-tree-rows'
import type { NodeState } from './sidebar-types'

const mysql: SafeConnection = {
  id: 'c1',
  engine: 'mysql',
  name: 'prod',
  host: 'h',
  port: 3306,
  username: 'root',
  database: 'shop',
  useSSH: false,
  createdAt: 1,
  updatedAt: 1,
  hasPassword: false,
  hasSSHPassword: false,
  hasSSHPrivateKey: false
}

const redis: SafeConnection = { ...mysql, id: 'c2', engine: 'redis', name: 'cache' }

function node(overrides: Partial<NodeState> = {}): NodeState {
  return { expanded: true, loading: false, tables: {}, expandedDbs: new Set(), ...overrides }
}

describe('buildSidebarRows', () => {
  it('links each focusable row to its parent so ← can move up a level', () => {
    const { rows, focusables } = buildSidebarRows({
      groups: groupConnections([mysql], 'Connections'),
      nodes: {
        c1: node({
          databases: ['shop'],
          tables: { shop: ['orders', 'users'] },
          expandedDbs: new Set(['shop'])
        })
      },
      tableFilters: {},
      collapsedRedisFolders: new Set()
    })

    expect(focusables.map((entry) => entry.label)).toEqual(['prod', 'shop', 'orders', 'users'])

    const table = rows.find((row) => row.type === 'table')!
    expect(table.parentIndex).toBe(1) // the database row
    expect(table.depth).toBe(2)

    const database = rows.find((row) => row.type === 'database')!
    expect(database.parentIndex).toBe(0) // the connection row
  })

  it('nests Redis keys under their ":" folders and hides collapsed subtrees', () => {
    const args = {
      groups: groupConnections([redis], 'Connections'),
      nodes: {
        c2: node({
          databases: ['0'],
          tables: { '0': ['user:1', 'user:2', 'flat'] },
          expandedDbs: new Set(['0'])
        })
      },
      tableFilters: {}
    }

    const expanded = buildSidebarRows({ ...args, collapsedRedisFolders: new Set() })
    expect(expanded.rows.filter((row) => row.type === 'redis-key')).toHaveLength(3)

    const collapsed = buildSidebarRows({
      ...args,
      collapsedRedisFolders: new Set(['c2:0:user'])
    })
    expect(collapsed.rows.filter((row) => row.type === 'redis-key')).toHaveLength(1)
  })

  it('renders the Redis truncation warning as a row, not a 3s toast', () => {
    const keys = Array.from({ length: REDIS_MAX_LISTED_KEYS }, (_, index) => `k${index}`)
    const { rows } = buildSidebarRows({
      groups: groupConnections([redis], 'Connections'),
      nodes: {
        c2: node({
          databases: ['0'],
          tables: { '0': keys },
          tableCounts: { '0': 84_213 },
          expandedDbs: new Set(['0'])
        })
      },
      tableFilters: {},
      collapsedRedisFolders: new Set()
    })

    const warning = rows.find((row) => row.type === 'truncated')
    expect(warning).toMatchObject({ shown: REDIS_MAX_LISTED_KEYS, total: 84_213 })
  })

  it('reports "no match" separately from "empty" when a filter is applied', () => {
    const { rows } = buildSidebarRows({
      groups: groupConnections([mysql], 'Connections'),
      nodes: {
        c1: node({
          databases: ['shop'],
          tables: { shop: ['orders'] },
          expandedDbs: new Set(['shop'])
        })
      },
      tableFilters: { 'c1:shop': 'zzz' },
      collapsedRedisFolders: new Set()
    })

    expect(rows.find((row) => row.type === 'message')).toMatchObject({
      message: 'noTablesMatch'
    })
  })
})
