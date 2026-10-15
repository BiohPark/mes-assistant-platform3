import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { expect, it } from 'vitest'
import { createTempDb, MIGRATION_TEST_TIMEOUT_MS } from '../test/tempDb.js'
import { createPool } from './connection.js'
import { runMigrations } from './migrate.js'
import { seedCatalog } from './seed.js'
import { assistant, task } from './schema.js'

it('upgrades populated text statuses to varchar, preserves the status constraint and adds the activity index', async () => {
  const temp = await createTempDb('status_upgrade')
  const pool = createPool(temp.url)
  const folder = await mkdtemp(join(tmpdir(), 's14-status-migrations-'))
  try {
    const source = resolve(import.meta.dirname, '../../drizzle')
    const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8'))
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 15)
    await mkdir(join(folder, 'meta'))
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal))
    for (const entry of journal.entries) await copyFile(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
    const db = drizzle(pool)
    await migrate(db, { migrationsFolder: folder })
    await seedCatalog(db)
    const [agent] = await db.select().from(assistant).limit(1)
    const statuses = ['todo', 'in_progress', 'on_hold', 'done']
    await db.insert(task).values(statuses.map(status => ({ id: status, code: status, assistantId: agent!.id, title: status, titleSource: 'manual',
      status, ownerId: 'seed-system', createdBy: 'seed-system', priority: 'normal', lastActivityAt: new Date('2026-10-01T00:00:00Z') })))
    await runMigrations(temp.url)
    await runMigrations(temp.url)
    expect((await db.select().from(task)).map(row => row.status).sort()).toEqual([...statuses].sort())
    const [columns] = await pool.query("show columns from task where Field = 'status'")
    expect((columns as Array<{ Type: string }>)[0]?.Type).toBe('varchar(32)')
    const [indexes] = await pool.query("show index from task where Key_name = 'task_status_last_activity'")
    expect((indexes as Array<{ Column_name: string }>).map(row => row.Column_name)).toEqual(['status', 'last_activity_at'])
    await expect(pool.query("update task set status = 'unknown' where id = 'done'")).rejects.toMatchObject({ errno: 4025 })
  } finally { await pool.end(); await temp.drop(); await rm(folder, { recursive: true, force: true }) }
}, MIGRATION_TEST_TIMEOUT_MS)
