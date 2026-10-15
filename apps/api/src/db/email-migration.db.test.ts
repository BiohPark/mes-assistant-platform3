import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { expect, it } from 'vitest'
import { createTempDb, MIGRATION_TEST_TIMEOUT_MS } from '../test/tempDb.js'
import { createPool } from './connection.js'
import { runMigrations } from './migrate.js'

it('이메일 추가 마이그레이션은 기존 계정 값을 변경·백필하지 않는다', async () => {
  const temp = await createTempDb('email_upgrade')
  const pool = createPool(temp.url, 1)
  const migrations = resolve(import.meta.dirname, '../../drizzle')
  const previous = await mkdtemp(resolve(import.meta.dirname, '../../.email-migrations-'))
  try {
    const journal = JSON.parse(await readFile(resolve(migrations, 'meta/_journal.json'), 'utf8'))
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 7)
    await mkdir(resolve(previous, 'meta'))
    await writeFile(resolve(previous, 'meta/_journal.json'), JSON.stringify(journal))
    for (const entry of journal.entries) await copyFile(resolve(migrations, `${entry.tag}.sql`), resolve(previous, `${entry.tag}.sql`))
    await migrate(drizzle(pool), { migrationsFolder: previous })
    await pool.query("insert into app_user (id, login_id, password_hash, name, initials, color, is_system_owner) values ('legacy', 'legacy-id', 'unchanged-hash', 'Existing', 'E', '#000', true)")
    const [before] = await pool.query('select * from app_user')
    await runMigrations(temp.url)
    const [after] = await pool.query('select * from app_user')
    expect(after).toEqual((before as Record<string, unknown>[]).map(row => ({ ...row, email: null })))
    const [columns] = await pool.query("select DATA_TYPE as type, CHARACTER_MAXIMUM_LENGTH as maxLength, IS_NULLABLE as nullable from information_schema.columns where table_schema = database() and table_name = 'app_user' and column_name = 'email'")
    expect(columns).toEqual([expect.objectContaining({ type: 'varchar', maxLength: 191, nullable: 'YES' })])
  } finally {
    await pool.end()
    await temp.drop()
    await rm(previous, { recursive: true, force: true })
  }
}, MIGRATION_TEST_TIMEOUT_MS)
