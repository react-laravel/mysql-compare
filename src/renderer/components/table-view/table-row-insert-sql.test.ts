import { describe, expect, it } from 'vitest'
import { buildRowInsertSQL } from './table-row-insert-sql'
import { testColumns } from './table-data-test-helpers'

describe('buildRowInsertSQL', () => {
  const row = { id: 7, name: "O'Reilly", active: 1 }

  it('builds a MySQL INSERT with the generated ID', () => {
    expect(
      buildRowInsertSQL({
        engine: 'mysql',
        database: 'rpg',
        table: 'users',
        columns: testColumns,
        row,
        includeId: true
      })
    ).toBe(
      "INSERT INTO `rpg`.`users` (`id`, `name`, `active`) VALUES\n  (7, 'O''Reilly', 1);"
    )
  })

  it('builds a MySQL INSERT without the generated ID', () => {
    expect(
      buildRowInsertSQL({
        engine: 'mysql',
        database: 'rpg',
        table: 'users',
        columns: testColumns,
        row,
        includeId: false
      })
    ).toBe("INSERT INTO `rpg`.`users` (`name`, `active`) VALUES\n  ('O''Reilly', 1);")
  })

  it('uses PostgreSQL identifiers and literals', () => {
    expect(
      buildRowInsertSQL({
        engine: 'postgres',
        database: 'app',
        table: 'users',
        columns: testColumns,
        row: { id: 7, name: 'Alice', active: true },
        includeId: false
      })
    ).toBe('INSERT INTO "public"."users" ("name", "active") VALUES\n  (\'Alice\', TRUE);')
  })
})
