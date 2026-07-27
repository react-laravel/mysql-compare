/**
 * Deterministic fixtures for the browser dev preview (see `dev-mock-api.ts`).
 *
 * Everything here is pure data or a pure generator seeded by row index, so the
 * preview paints the same bytes on every reload and screenshots are stable.
 */
import { REDIS_MAX_LISTED_KEYS } from '../../shared/constants'
import type { ColumnInfo, IndexInfo, SafeConnection, SSHFileEntry, SSHFileEntryType } from '../../shared/types'
import { testColumns, testRows } from '../components/table-view/table-data-test-helpers'

// ------------------------------------------------------------- fixture data

/** Fixed clock so every generated timestamp is reproducible. */
export const NOW = Date.UTC(2026, 6, 27, 9, 0, 0)
const DAY = 86_400_000

const FIRST_NAMES = [
  'Ada', 'Bruno', 'Carol', 'Dai', 'Elena', 'Farid', 'Grace', 'Hana',
  'Ivan', 'Júlia', 'Kenji', 'Lena', 'Marco', 'Nour', 'Olga', 'Pavel'
] as const
const LAST_NAMES = [
  'Lovelace', 'Ferreira', 'Nakamura', 'Okonkwo', 'Silva', 'Novak',
  'Haddad', 'Weber', 'Petrov', 'Andersen', 'Rossi', 'Kaur'
] as const
const ORDER_STATUS = ['pending', 'paid', 'shipped', 'refunded', 'cancelled'] as const
const PAYMENT_PROVIDERS = ['stripe', 'paypal', 'adyen'] as const
const PRODUCT_WORDS = ['Kettle', 'Lamp', 'Chair', 'Desk', 'Mug', 'Shelf', 'Rug', 'Clock'] as const

export function pick<T>(list: readonly T[], index: number): T {
  const value = list[((index % list.length) + list.length) % list.length]
  // Modulo above is always in range; the assertion only satisfies
  // noUncheckedIndexedAccess.
  return value as T
}

/** Deterministic 0..1 from an integer seed. */
export function seeded(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

export function isoAt(offsetDays: number, offsetSeconds = 0): string {
  return new Date(NOW - offsetDays * DAY - offsetSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

export function hex(seed: number, length: number): string {
  let out = ''
  for (let i = 0; out.length < length; i += 1) {
    out += Math.floor(seeded(seed + i) * 0xffffffff).toString(16)
  }
  return out.slice(0, length)
}

// ---------------------------------------------------------------- schema DSL

export function column(name: string, type: string, overrides: Partial<ColumnInfo> = {}): ColumnInfo {
  return {
    name,
    type,
    nullable: false,
    defaultValue: null,
    isPrimaryKey: false,
    isAutoIncrement: false,
    comment: '',
    columnKey: '',
    ...overrides
  }
}

function idColumn(name = 'id', type = 'int unsigned'): ColumnInfo {
  return column(name, type, {
    isPrimaryKey: true,
    isAutoIncrement: true,
    columnKey: 'PRI',
    comment: 'primary key'
  })
}

export interface MockTableDef {
  columns: ColumnInfo[]
  primaryKey: string[]
  indexes: IndexInfo[]
  rowCount: number
  comment: string
  makeRow: (index: number) => Record<string, unknown>
}

function defineTable(def: {
  columns: ColumnInfo[]
  primaryKey?: string[]
  extraIndexes?: IndexInfo[]
  rowCount: number
  comment?: string
  makeRow: (index: number) => Record<string, unknown>
}): MockTableDef {
  const primaryKey = def.primaryKey ?? def.columns.filter((c) => c.isPrimaryKey).map((c) => c.name)
  const indexes: IndexInfo[] = [
    ...(primaryKey.length > 0
      ? [{ name: 'PRIMARY', columns: primaryKey, unique: true, type: 'BTREE' }]
      : []),
    ...(def.extraIndexes ?? [])
  ]
  return {
    columns: def.columns,
    primaryKey,
    indexes,
    rowCount: def.rowCount,
    comment: def.comment ?? '',
    makeRow: def.makeRow
  }
}

const TABLE_DEFS: Record<string, MockTableDef> = {
  users: defineTable({
    comment: 'Registered accounts',
    rowCount: 2483,
    columns: [
      idColumn(),
      column('email', 'varchar(191)', { columnKey: 'UNI', comment: 'login' }),
      column('name', 'varchar(120)'),
      column('role', 'varchar(32)', { defaultValue: 'customer' }),
      column('active', 'tinyint(1)', { defaultValue: '1' }),
      column('created_at', 'datetime', { nullable: true })
    ],
    extraIndexes: [
      { name: 'users_email_unique', columns: ['email'], unique: true, type: 'BTREE' },
      { name: 'users_role_index', columns: ['role'], unique: false, type: 'BTREE' }
    ],
    makeRow: (i) => ({
      id: i + 1,
      email: `${pick(FIRST_NAMES, i).toLowerCase()}.${pick(LAST_NAMES, i * 3).toLowerCase()}${i}@example.com`,
      name: `${pick(FIRST_NAMES, i)} ${pick(LAST_NAMES, i * 3)}`,
      role: i === 0 ? 'admin' : pick(['staff', 'customer', 'customer', 'customer'], i),
      active: i % 11 === 0 ? 0 : 1,
      created_at: isoAt(Math.floor(seeded(i) * 900), i * 37)
    })
  }),
  orders: defineTable({
    comment: 'Customer orders',
    rowCount: 18_420,
    columns: [
      idColumn('id', 'bigint unsigned'),
      column('user_id', 'int unsigned', { columnKey: 'MUL' }),
      column('status', 'varchar(24)', { defaultValue: 'pending', columnKey: 'MUL' }),
      column('total', 'decimal(10,2)', { defaultValue: '0.00' }),
      column('currency', 'char(3)', { defaultValue: 'USD' }),
      column('note', 'text', { nullable: true }),
      column('placed_at', 'datetime')
    ],
    extraIndexes: [
      { name: 'orders_user_id_index', columns: ['user_id'], unique: false, type: 'BTREE' },
      { name: 'orders_status_placed_at_index', columns: ['status', 'placed_at'], unique: false, type: 'BTREE' }
    ],
    makeRow: (i) => ({
      id: i + 1,
      user_id: (i * 13) % 2483 + 1,
      status: pick(ORDER_STATUS, i),
      total: (seeded(i * 5) * 940 + 9).toFixed(2),
      currency: i % 4 === 0 ? 'EUR' : 'USD',
      note: i % 9 === 0 ? null : `web checkout #${i + 1}`,
      placed_at: isoAt(Math.floor(seeded(i * 2) * 400), i * 11)
    })
  }),
  order_items: defineTable({
    comment: 'Order line items',
    rowCount: 54_219,
    columns: [
      idColumn('id', 'bigint unsigned'),
      column('order_id', 'bigint unsigned', { columnKey: 'MUL' }),
      column('product_id', 'int unsigned', { columnKey: 'MUL' }),
      column('qty', 'smallint unsigned', { defaultValue: '1' }),
      column('unit_price', 'decimal(10,2)')
    ],
    extraIndexes: [
      { name: 'order_items_order_id_index', columns: ['order_id'], unique: false, type: 'BTREE' }
    ],
    makeRow: (i) => ({
      id: i + 1,
      order_id: (i % 18_420) + 1,
      product_id: (i * 7) % 1204 + 1,
      qty: Math.floor(seeded(i) * 4) + 1,
      unit_price: (seeded(i * 3) * 180 + 4).toFixed(2)
    })
  }),
  products: defineTable({
    comment: 'Catalogue',
    rowCount: 1204,
    columns: [
      idColumn(),
      column('sku', 'varchar(32)', { columnKey: 'UNI' }),
      column('name', 'varchar(160)'),
      column('price', 'decimal(10,2)'),
      column('stock', 'int', { defaultValue: '0' }),
      column('category_id', 'int unsigned', { nullable: true, columnKey: 'MUL' })
    ],
    extraIndexes: [{ name: 'products_sku_unique', columns: ['sku'], unique: true, type: 'BTREE' }],
    makeRow: (i) => ({
      id: i + 1,
      sku: `SKU-${(10_000 + i).toString()}`,
      name: `${pick(PRODUCT_WORDS, i)} ${pick(['Mini', 'Classic', 'Pro', 'Max'], i * 3)}`,
      price: (seeded(i * 9) * 260 + 6).toFixed(2),
      stock: Math.floor(seeded(i * 11) * 420),
      category_id: i % 17 === 0 ? null : (i % 28) + 1
    })
  }),
  categories: defineTable({
    comment: 'Product categories',
    rowCount: 28,
    columns: [idColumn(), column('name', 'varchar(80)'), column('slug', 'varchar(80)', { columnKey: 'UNI' })],
    makeRow: (i) => ({
      id: i + 1,
      name: `${pick(PRODUCT_WORDS, i)}s`,
      slug: `${pick(PRODUCT_WORDS, i).toLowerCase()}s-${i + 1}`
    })
  }),
  payments: defineTable({
    comment: 'Captured payments',
    rowCount: 9310,
    columns: [
      idColumn('id', 'bigint unsigned'),
      column('order_id', 'bigint unsigned', { columnKey: 'MUL' }),
      column('provider', 'varchar(24)'),
      column('amount', 'decimal(10,2)'),
      column('captured_at', 'datetime', { nullable: true })
    ],
    makeRow: (i) => ({
      id: i + 1,
      order_id: (i * 2) % 18_420 + 1,
      provider: pick(PAYMENT_PROVIDERS, i),
      amount: (seeded(i * 6) * 900 + 12).toFixed(2),
      captured_at: i % 23 === 0 ? null : isoAt(Math.floor(seeded(i) * 300), i * 5)
    })
  }),
  sessions: defineTable({
    comment: 'Login sessions (no primary key — exercises the no-PK banner)',
    rowCount: 743,
    primaryKey: [],
    columns: [
      column('token', 'char(40)'),
      column('user_id', 'int unsigned', { nullable: true }),
      column('ip', 'varchar(45)'),
      column('last_seen', 'datetime')
    ],
    makeRow: (i) => ({
      token: hex(i + 1, 40),
      user_id: i % 13 === 0 ? null : (i * 5) % 2483 + 1,
      ip: `10.0.${i % 255}.${(i * 7) % 255}`,
      last_seen: isoAt(0, i * 97)
    })
  }),
  migrations: defineTable({
    comment: 'Schema migrations',
    rowCount: 46,
    columns: [idColumn(), column('migration', 'varchar(191)'), column('batch', 'int')],
    makeRow: (i) => ({
      id: i + 1,
      migration: `2026_0${(i % 9) + 1}_${(10 + i).toString()}_000000_migration_${i + 1}`,
      batch: Math.floor(i / 8) + 1
    })
  }),
  audit_log: defineTable({
    comment: 'Staging-only audit trail',
    rowCount: 5120,
    columns: [
      idColumn('id', 'bigint unsigned'),
      column('actor', 'varchar(120)'),
      column('action', 'varchar(64)', { columnKey: 'MUL' }),
      column('payload', 'json', { nullable: true }),
      column('at', 'datetime')
    ],
    makeRow: (i) => ({
      id: i + 1,
      actor: `${pick(FIRST_NAMES, i)} ${pick(LAST_NAMES, i)}`,
      action: pick(['create', 'update', 'delete', 'login', 'export'], i),
      payload: JSON.stringify({ table: pick(['users', 'orders', 'products'], i), changed: i % 5 }),
      at: isoAt(Math.floor(seeded(i) * 60), i * 13)
    })
  }),
  events: defineTable({
    comment: 'Analytics event stream',
    rowCount: 402_113,
    columns: [
      idColumn('id', 'bigint'),
      column('name', 'text', { columnKey: 'MUL' }),
      column('props', 'jsonb', { nullable: true }),
      column('occurred_at', 'timestamptz')
    ],
    extraIndexes: [{ name: 'events_name_idx', columns: ['name'], unique: false, type: 'BTREE' }],
    makeRow: (i) => ({
      id: i + 1,
      name: pick(['page_view', 'add_to_cart', 'checkout', 'signup', 'search'], i),
      props: JSON.stringify({ path: `/p/${(i % 1204) + 1}`, ms: Math.floor(seeded(i) * 900) }),
      occurred_at: isoAt(Math.floor(seeded(i * 4) * 90), i * 3)
    })
  }),
  // The two tables below are backed verbatim by the grid's own unit-test
  // fixtures, so the browser preview and `TableDataGrid`'s tests describe the
  // same rows. `v_feature_flags` is a view, hence no primary key — that is the
  // reachable path to the "no primary key" banner with a small result set.
  feature_flags: defineTable({
    comment: 'Feature flags',
    rowCount: testRows.length,
    columns: testColumns,
    makeRow: (i) => testRows[i % testRows.length] ?? {}
  }),
  v_feature_flags: defineTable({
    comment: 'View over feature_flags',
    rowCount: testRows.length,
    primaryKey: [],
    columns: testColumns.map((c) => ({ ...c, isPrimaryKey: false, columnKey: '' })),
    makeRow: (i) => testRows[i % testRows.length] ?? {}
  }),
  users_dim: defineTable({
    comment: 'User dimension',
    rowCount: 2483,
    columns: [
      idColumn('id', 'bigint'),
      column('email', 'text', { columnKey: 'UNI' }),
      column('first_seen', 'date'),
      column('orders_count', 'integer', { defaultValue: '0' }),
      column('lifetime_value', 'numeric(12,2)', { defaultValue: '0.00' })
    ],
    makeRow: (i) => ({
      id: i + 1,
      email: `${pick(FIRST_NAMES, i).toLowerCase()}${i}@example.com`,
      first_seen: isoAt(Math.floor(seeded(i) * 900)).slice(0, 10),
      orders_count: Math.floor(seeded(i * 2) * 40),
      lifetime_value: (seeded(i * 8) * 5200).toFixed(2)
    })
  })
}

const FALLBACK_TABLE: MockTableDef = defineTable({
  comment: '',
  rowCount: 128,
  columns: [idColumn(), column('name', 'varchar(120)'), column('created_at', 'datetime')],
  makeRow: (i) => ({ id: i + 1, name: `row ${i + 1}`, created_at: isoAt(i) })
})

export function tableDef(table: string): MockTableDef {
  return TABLE_DEFS[table] ?? FALLBACK_TABLE
}

/** Redis values are surfaced through the same grid, as field/value pairs. */
export const REDIS_COLUMNS: ColumnInfo[] = [
  column('field', 'string', { isPrimaryKey: true, columnKey: 'PRI' }),
  column('value', 'string')
]

// ------------------------------------------------------------ connection set

function connection(overrides: Partial<SafeConnection> & Pick<SafeConnection, 'id' | 'engine' | 'name' | 'host' | 'port' | 'username'>): SafeConnection {
  return {
    useSSH: false,
    hasPassword: true,
    hasSSHPassword: false,
    hasSSHPrivateKey: false,
    createdAt: NOW - 40 * DAY,
    updatedAt: NOW - 2 * DAY,
    ...overrides
  }
}

const MYSQL_ID = 'mock-mysql'
const MYSQL_SSH_ID = 'mock-mysql-ssh'
const POSTGRES_ID = 'mock-postgres'
const REDIS_ID = 'mock-redis'

export function initialConnections(): SafeConnection[] {
  return [
    connection({
      id: MYSQL_ID,
      engine: 'mysql',
      name: 'shop · production',
      group: 'Production',
      host: '10.0.0.12',
      port: 3306,
      username: 'app',
      database: 'shop'
    }),
    connection({
      id: MYSQL_SSH_ID,
      engine: 'mysql',
      name: 'shop · staging',
      group: 'Staging',
      host: '127.0.0.1',
      port: 3306,
      username: 'app',
      database: 'shop_staging',
      useSSH: true,
      sshHost: 'bastion.staging.internal',
      sshPort: 22,
      sshUsername: 'deploy',
      sshPrivateKeyPath: '~/.ssh/id_ed25519',
      hasSSHPrivateKey: true
    }),
    connection({
      id: POSTGRES_ID,
      engine: 'postgres',
      name: 'analytics · warehouse',
      group: 'Production',
      host: '10.0.0.31',
      port: 5432,
      username: 'postgres',
      database: 'analytics',
      // Exercises the per-database credential badge in the sidebar tree.
      databaseCredentials: { analytics: { username: 'analytics_ro', hasPassword: true } }
    }),
    connection({
      id: REDIS_ID,
      engine: 'redis',
      name: 'cache · edge',
      host: '10.0.0.44',
      port: 6379,
      username: '',
      hasPassword: false
    })
  ]
}

export const SHOP_TABLES = [
  'categories', 'feature_flags', 'migrations', 'order_items', 'orders', 'payments', 'products',
  'sessions', 'users', 'v_feature_flags'
]
const SHOP_STAGING_TABLES = [
  'audit_log', 'categories', 'feature_flags', 'migrations', 'order_items', 'orders', 'products',
  'sessions', 'users', 'v_feature_flags'
]

function redisKeys(count: number): string[] {
  const keys: string[] = []
  for (let i = 0; i < count; i += 1) {
    const kind = pick(['cache:user', 'cache:product', 'session', 'queue:jobs', 'rate:ip'], i)
    keys.push(`${kind}:${i + 1}`)
  }
  return keys
}

export function initialDatabases(): Record<string, Record<string, string[]>> {
  return {
    [MYSQL_ID]: {
      shop: [...SHOP_TABLES],
      shop_archive: ['orders', 'order_items', 'payments'],
      information_schema: ['COLUMNS', 'TABLES', 'STATISTICS']
    },
    [MYSQL_SSH_ID]: {
      shop_staging: [...SHOP_STAGING_TABLES],
      information_schema: ['COLUMNS', 'TABLES', 'STATISTICS']
    },
    [POSTGRES_ID]: {
      analytics: ['events', 'users_dim'],
      analytics_archive: ['events']
    },
    [REDIS_ID]: {
      // db0 is small so the first expand is cheap; db1 sits exactly on the
      // listing soft-cap, which is what marks a key list as truncated — a
      // deliberate second click, because it paints 10k tree rows.
      db0: redisKeys(140),
      db1: redisKeys(REDIS_MAX_LISTED_KEYS)
    }
  }
}

/** Redis reports more keys than it lists for db1, which is what marks it truncated. */
export const REDIS_TOTAL_KEYS: Record<string, number> = { db0: 140, db1: 24_318 }

// ---------------------------------------------------------------- SSH fixture

export interface SeedEntry {
  name: string
  type: SSHFileEntryType
  size?: number
  permissions?: string
  days?: number
}

const SSH_TREE_SEED: Record<string, SeedEntry[]> = {
  '/': [
    { name: 'etc', type: 'directory' },
    { name: 'home', type: 'directory' },
    { name: 'opt', type: 'directory' },
    { name: 'srv', type: 'directory' },
    { name: 'tmp', type: 'directory', permissions: 'drwxrwxrwt' },
    { name: 'var', type: 'directory' }
  ],
  '/home': [{ name: 'deploy', type: 'directory' }],
  '/home/deploy': [
    { name: 'app', type: 'directory', days: 1 },
    { name: 'releases', type: 'directory', days: 1 },
    { name: '.bashrc', type: 'file', size: 3771, days: 210 },
    { name: 'current', type: 'symlink', size: 34, days: 1, permissions: 'lrwxrwxrwx' },
    { name: 'deploy.sh', type: 'file', size: 1842, days: 6, permissions: '-rwxr-xr-x' },
    { name: 'notes.md', type: 'file', size: 902, days: 3 },
    { name: 'shop-2026-07-26.sql.gz', type: 'file', size: 48_213_770, days: 1 }
  ],
  '/home/deploy/app': [
    { name: 'public', type: 'directory', days: 2 },
    { name: 'src', type: 'directory', days: 2 },
    { name: '.env', type: 'file', size: 412, days: 9, permissions: '-rw-------' },
    { name: 'README.md', type: 'file', size: 2140, days: 20 },
    { name: 'package.json', type: 'file', size: 1384, days: 2 }
  ],
  '/home/deploy/releases': [
    { name: '2026-07-20', type: 'directory', days: 7 },
    { name: '2026-07-26', type: 'directory', days: 1 }
  ],
  '/var': [
    { name: 'log', type: 'directory' },
    { name: 'www', type: 'directory' }
  ],
  '/var/log': [
    { name: 'nginx', type: 'directory', days: 1 },
    { name: 'app.log', type: 'file', size: 1_204_882, days: 0 },
    { name: 'syslog', type: 'file', size: 8_402_113, days: 0 }
  ]
}

export const SSH_FILE_CONTENTS: Record<string, string> = {
  '/home/deploy/notes.md':
    '# Deploy notes\n\n- `./deploy.sh` runs migrations then restarts the unit.\n- Staging DB is reachable through this bastion only.\n',
  '/home/deploy/deploy.sh':
    '#!/usr/bin/env bash\nset -euo pipefail\n\ncd /home/deploy/app\nnpm ci --omit=dev\nnpm run migrate\nsystemctl --user restart shop-api\n',
  '/home/deploy/app/package.json':
    '{\n  "name": "shop-api",\n  "version": "3.4.1",\n  "private": true\n}\n'
}

export function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

export function parentOf(path: string): string | null {
  if (path === '/') return null
  const index = path.lastIndexOf('/')
  if (index <= 0) return '/'
  return path.slice(0, index)
}

export function seedToEntry(dir: string, seed: SeedEntry): SSHFileEntry {
  const defaultPermissions = seed.type === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--'
  return {
    name: seed.name,
    path: joinPath(dir, seed.name),
    type: seed.type,
    size: seed.size ?? (seed.type === 'directory' ? 4096 : 0),
    modifiedAt: NOW - (seed.days ?? 30) * DAY,
    permissions: seed.permissions ?? defaultPermissions
  }
}

/** The seeded contents of a remote directory; empty for unknown paths. */
export function sshSeedEntries(path: string): SSHFileEntry[] {
  return (SSH_TREE_SEED[path] ?? []).map((item) => seedToEntry(path, item))
}
