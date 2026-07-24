import type { DbEngine } from '../../../shared/types'
import type { ColumnDraft, IndexDraft } from './table-structure-types'

type SqlEngine = Exclude<DbEngine, 'redis'>

export function buildAlterColumnSQL(
  engine: SqlEngine,
  database: string,
  table: string,
  draft: ColumnDraft
): string {
  if (engine === 'postgres') {
    return buildPostgresAlterColumnSQL(database, table, draft)
  }
  return buildMySQLAlterColumnSQL(database, table, draft)
}

export function buildIndexSQL(
  engine: SqlEngine,
  database: string,
  table: string,
  draft: IndexDraft
): string {
  if (engine === 'postgres') {
    return buildPostgresIndexSQL(database, table, draft)
  }
  return buildMySQLIndexSQL(database, table, draft)
}

export function buildDropIndexSQL(
  engine: SqlEngine,
  database: string,
  table: string,
  indexName: string
): string {
  if (engine === 'postgres') {
    if (indexName === 'PRIMARY') {
      return `ALTER TABLE ${quoteTable('postgres', database, table)} DROP CONSTRAINT ${quoteIdent('postgres', `${table}_pkey`)};`
    }
    return `DROP INDEX IF EXISTS ${quoteIdent('postgres', indexName)};`
  }
  return `ALTER TABLE ${quoteTable('mysql', database, table)} ${buildMySQLDropIndexClause(indexName)};`
}

function buildMySQLAlterColumnSQL(database: string, table: string, draft: ColumnDraft): string {
  const definition = [
    quoteIdent('mysql', draft.name.trim()),
    draft.type.trim(),
    draft.nullable ? 'NULL' : 'NOT NULL',
    buildDefaultClause(draft),
    draft.isAutoIncrement ? 'AUTO_INCREMENT' : '',
    `COMMENT ${quoteString(draft.comment)}`
  ]
    .filter(Boolean)
    .join(' ')

  const action =
    draft.originalName === draft.name.trim()
      ? 'MODIFY COLUMN'
      : `CHANGE COLUMN ${quoteIdent('mysql', draft.originalName)}`
  return `ALTER TABLE ${quoteTable('mysql', database, table)} ${action} ${definition};`
}

function buildPostgresAlterColumnSQL(database: string, table: string, draft: ColumnDraft): string {
  const target = quoteTable('postgres', database, table)
  const original = quoteIdent('postgres', draft.originalName)
  const nextName = draft.name.trim()
  const statements: string[] = []

  if (draft.originalName !== nextName) {
    statements.push(`ALTER TABLE ${target} RENAME COLUMN ${original} TO ${quoteIdent('postgres', nextName)}`)
  }

  const column = quoteIdent('postgres', nextName)
  statements.push(`ALTER TABLE ${target} ALTER COLUMN ${column} TYPE ${draft.type.trim()}`)
  statements.push(
    draft.nullable
      ? `ALTER TABLE ${target} ALTER COLUMN ${column} DROP NOT NULL`
      : `ALTER TABLE ${target} ALTER COLUMN ${column} SET NOT NULL`
  )

  if (!draft.useDefault) {
    statements.push(`ALTER TABLE ${target} ALTER COLUMN ${column} DROP DEFAULT`)
  } else {
    const value = draft.defaultValue.trim()
    if (!value) {
      statements.push(`ALTER TABLE ${target} ALTER COLUMN ${column} SET DEFAULT NULL`)
    } else if (isSQLKeywordDefault(value) || isNumericLike(draft.type, value)) {
      statements.push(`ALTER TABLE ${target} ALTER COLUMN ${column} SET DEFAULT ${value}`)
    } else {
      statements.push(`ALTER TABLE ${target} ALTER COLUMN ${column} SET DEFAULT ${quoteString(value)}`)
    }
  }

  if (draft.comment.trim()) {
    statements.push(
      `COMMENT ON COLUMN ${target}.${column} IS ${quoteString(draft.comment)}`
    )
  }

  return `${statements.join(';\n')};`
}

function buildMySQLIndexSQL(database: string, table: string, draft: IndexDraft): string {
  const addClause = buildMySQLAddIndexClause(draft)
  if (draft.mode === 'add') {
    return `ALTER TABLE ${quoteTable('mysql', database, table)} ${addClause};`
  }
  return `ALTER TABLE ${quoteTable('mysql', database, table)} ${buildMySQLDropIndexClause(draft.originalName || draft.name)}, ${addClause};`
}

function buildPostgresIndexSQL(database: string, table: string, draft: IndexDraft): string {
  const target = quoteTable('postgres', database, table)
  const columns = draft.columns.map((column) => quoteIdent('postgres', column)).join(', ')
  const statements: string[] = []

  if (draft.mode === 'edit') {
    if (draft.originalName === 'PRIMARY' || draft.primary) {
      statements.push(`ALTER TABLE ${target} DROP CONSTRAINT ${quoteIdent('postgres', `${table}_pkey`)}`)
    } else if (draft.originalName) {
      statements.push(`DROP INDEX IF EXISTS ${quoteIdent('postgres', draft.originalName)}`)
    }
  }

  if (draft.primary) {
    statements.push(`ALTER TABLE ${target} ADD PRIMARY KEY (${columns})`)
  } else {
    const unique = draft.unique ? 'UNIQUE ' : ''
    const usingClause = draft.type.trim() ? ` USING ${draft.type.trim().toUpperCase()}` : ''
    statements.push(
      `CREATE ${unique}INDEX ${quoteIdent('postgres', draft.name.trim())} ON ${target}${usingClause} (${columns})`
    )
  }

  return `${statements.join(';\n')};`
}

function buildMySQLAddIndexClause(draft: IndexDraft): string {
  const columns = draft.columns.map((column) => quoteIdent('mysql', column)).join(', ')
  const usingClause = !draft.primary && draft.type.trim() ? `USING ${draft.type.trim().toUpperCase()} ` : ''
  if (draft.primary) {
    return `ADD PRIMARY KEY (${columns})`
  }
  if (draft.unique) {
    return `ADD UNIQUE INDEX ${quoteIdent('mysql', draft.name.trim())} ${usingClause}(${columns})`
  }
  return `ADD INDEX ${quoteIdent('mysql', draft.name.trim())} ${usingClause}(${columns})`
}

function buildMySQLDropIndexClause(indexName: string): string {
  return indexName === 'PRIMARY' ? 'DROP PRIMARY KEY' : `DROP INDEX ${quoteIdent('mysql', indexName)}`
}

function buildDefaultClause(draft: ColumnDraft): string {
  if (!draft.useDefault) return ''
  const value = draft.defaultValue.trim()
  if (!value) return 'DEFAULT NULL'
  if (isSQLKeywordDefault(value)) return `DEFAULT ${value}`
  if (isNumericLike(draft.type, value)) return `DEFAULT ${value}`
  return `DEFAULT ${quoteString(value)}`
}

function isSQLKeywordDefault(value: string): boolean {
  return /^(null|current_timestamp(?:\(\))?|current_date(?:\(\))?|current_time(?:\(\))?|now\(\))$/i.test(value)
}

function isNumericLike(type: string, value: string): boolean {
  return (
    /^(tinyint|smallint|mediumint|int|bigint|decimal|numeric|float|double|real|bit|serial|bigserial)/i.test(type) &&
    /^-?\d+(\.\d+)?$/.test(value)
  )
}

function quoteIdent(engine: SqlEngine, name: string): string {
  if (engine === 'postgres') {
    return `"${name.replace(/"/g, '""')}"`
  }
  return `\`${name.replace(/`/g, '``')}\``
}

function quoteTable(engine: SqlEngine, database: string, table: string): string {
  // PG MVP pins UI "database" to the real database; table ops always use public schema.
  const schema = engine === 'postgres' ? 'public' : database
  return `${quoteIdent(engine, schema)}.${quoteIdent(engine, table)}`
}

function quoteString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}
