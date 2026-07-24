import { describe, expect, it } from 'vitest'
import {
  buildAlterColumnSQL,
  buildDropIndexSQL,
  buildIndexSQL
} from './table-structure-sql'

describe('table-structure-sql', () => {
  it('builds MySQL CHANGE COLUMN when renaming', () => {
    const sql = buildAlterColumnSQL('mysql', 'shop', 'users', {
      originalName: 'name',
      name: 'full_name',
      type: 'varchar(255)',
      nullable: false,
      defaultValue: '',
      useDefault: false,
      comment: 'display',
      isAutoIncrement: false
    })
    expect(sql).toContain('CHANGE COLUMN `name`')
    expect(sql).toContain('`full_name` varchar(255) NOT NULL')
    expect(sql).toContain("COMMENT 'display'")
  })

  it('builds PostgreSQL ALTER statements instead of MySQL CHANGE COLUMN', () => {
    const sql = buildAlterColumnSQL('postgres', 'analytics', 'users', {
      originalName: 'name',
      name: 'full_name',
      type: 'character varying(255)',
      nullable: true,
      defaultValue: '',
      useDefault: false,
      comment: 'display',
      isAutoIncrement: false
    })
    expect(sql).not.toContain('CHANGE COLUMN')
    expect(sql).not.toContain('MODIFY COLUMN')
    expect(sql).toContain('ALTER TABLE "public"."users" RENAME COLUMN "name" TO "full_name"')
    expect(sql).toContain('ALTER COLUMN "full_name" TYPE character varying(255)')
    expect(sql).toContain('DROP NOT NULL')
    expect(sql).toContain('DROP DEFAULT')
    expect(sql).toContain('COMMENT ON COLUMN "public"."users"."full_name" IS \'display\'')
  })

  it('builds PostgreSQL index create/drop SQL', () => {
    const addSQL = buildIndexSQL('postgres', 'analytics', 'users', {
      mode: 'add',
      name: 'users_email_idx',
      columns: ['email'],
      unique: true,
      primary: false,
      type: 'BTREE'
    })
    expect(addSQL).toContain('CREATE UNIQUE INDEX "users_email_idx" ON "public"."users" USING BTREE ("email")')

    const dropSQL = buildDropIndexSQL('postgres', 'analytics', 'users', 'users_email_idx')
    expect(dropSQL).toBe('DROP INDEX IF EXISTS "users_email_idx";')
  })
})
