import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTempDb } from '../test/tempDb.js'
import { runMigrations } from './migrate.js'

const draftSql = resolve(import.meta.dirname, '../../../../docs/architecture/postgres-draft.sql')

/** public 스키마의 구조를 이름 무관하게 비교 가능한 문자열 목록으로 */
async function describeSchema(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => undefined })
  try {
    const columns = await sql`
      select table_name, column_name, data_type, character_maximum_length, is_nullable, column_default
      from information_schema.columns where table_schema = 'public'
      order by table_name, ordinal_position`
    const constraints = await sql`
      select c.conrelid::regclass::text as table_name, c.contype, pg_get_constraintdef(c.oid) as def
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'public' order by 1, 2, 3`
    const indexes = await sql`
      select tablename, regexp_replace(indexdef, '^CREATE (UNIQUE )?INDEX \\S+ ON ', 'CREATE \\1INDEX ON ') as def
      from pg_indexes where schemaname = 'public' order by 1, 2`
    return {
      columns: columns.map((r) => Object.values(r).join(' | ')),
      constraints: constraints.map((r) => Object.values(r).join(' | ')).sort(),
      indexes: indexes.map((r) => Object.values(r).join(' | ')).sort(),
    }
  } finally {
    await sql.end()
  }
}

describe('Drizzle 마이그레이션 ↔ postgres-draft.sql', () => {
  let draft: Awaited<ReturnType<typeof createTempDb>>
  let migrated: Awaited<ReturnType<typeof createTempDb>>

  beforeAll(async () => {
    draft = await createTempDb('draft')
    migrated = await createTempDb('drizzle')
    const sql = postgres(draft.url, { max: 1, onnotice: () => undefined })
    await sql.unsafe(readFileSync(draftSql, 'utf8'))
    await sql.end()
    await runMigrations(migrated.url)
  })

  afterAll(async () => {
    await draft?.drop()
    await migrated?.drop()
  })

  it('컬럼·제약·인덱스가 같다', async () => {
    const [a, b] = await Promise.all([describeSchema(draft.url), describeSchema(migrated.url)])
    expect(b.columns).toEqual(a.columns)
    expect(b.constraints).toEqual(a.constraints)
    expect(b.indexes).toEqual(a.indexes)
  })
})
