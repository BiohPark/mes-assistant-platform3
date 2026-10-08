import { expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { eq } from 'drizzle-orm'
import { createTempDb } from '../test/tempDb.js'
import { createPool } from './connection.js'
import { runMigrations } from './migrate.js'
import { assertClassificationInvariants } from './classifications.js'
import { appUser, assistant, assistantClassification, codeGroup, code } from './schema.js'
import { DbCatalogReader } from '../catalog/catalog.service.js'
import { DbModule } from './db.module.js'

it('upgrades the pre-D schema preserving inactive original pairs, reruns safely and fails fast on corruption', async () => {
  const temp = await createTempDb('paths_upgrade'); const pool = createPool(temp.url)
  const folder = await mkdtemp(join(tmpdir(), 's7d-migrations-'))
  try {
    const source = resolve(import.meta.dirname, '../../drizzle')
    const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8'))
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 6)
    await mkdir(join(folder, 'meta'))
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal))
    for (const entry of journal.entries) await copyFile(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
    const db = drizzle(pool); await migrate(db, { migrationsFolder: folder })
    await db.insert(appUser).values({ id: 'upgrade-owner', name: 'Owner', initials: 'O', color: '#123456' })
    await db.insert(codeGroup).values([{ key: 'assistant_level1', name: 'Level 1' }, { key: 'assistant_level2', name: 'Level 2' }])
    await db.insert(code).values([{ id: 'old-one', groupKey: 'assistant_level1', code: 'one', name: 'One', active: false }, { id: 'old-two', groupKey: 'assistant_level2', code: 'two', name: 'Two', active: false }])
    await db.insert(assistant).values({ id: 'old-agent', name: 'Old', link1: 'https://example.invalid/legacy', level1CodeId: 'old-one', level2CodeId: 'old-two', ownerId: 'upgrade-owner', createdBy: 'upgrade-owner', sortOrder: 1, status: 'open', color: '#123456' })
    expect(await runMigrations(temp.url)).toEqual({ assistants: 1, classifications: 1, link1Overrides: 1 })
    expect(await db.select().from(assistantClassification)).toEqual([{ assistantId: 'old-agent', level1CodeId: 'old-one', level2CodeId: 'old-two', sortOrder: 0 }])
    expect((await db.select().from(code)).every(row => !row.active)).toBe(true)
    expect((await new DbCatalogReader(db).assistants())[0]).toMatchObject({ level1: 'One', level2: 'Two', classifications: [{ level1: 'One', level2: 'Two', level1CodeId: 'old-one', level2CodeId: 'old-two' }] })
    await expect(new DbModule(pool, db).onModuleInit()).resolves.toBeUndefined()
    await runMigrations(temp.url)
    expect(await db.select().from(assistantClassification)).toHaveLength(1)
    await db.update(assistantClassification).set({ sortOrder: 1 }).where(eq(assistantClassification.assistantId, 'old-agent'))
    await expect(assertClassificationInvariants(db)).rejects.toThrow(/불변식/)
    await db.update(assistantClassification).set({ sortOrder: 0 }).where(eq(assistantClassification.assistantId, 'old-agent'))
    await db.update(assistant).set({ level1CodeId: 'old-two' }).where(eq(assistant.id, 'old-agent'))
    await expect(new DbModule(pool, db).onModuleInit()).rejects.toThrow(/불변식/)
    await db.delete(assistantClassification)
    await expect(new DbModule(pool, db).onModuleInit()).rejects.toThrow(/불변식/)
  } finally { await pool.end(); await temp.drop(); await rm(folder, { recursive: true, force: true }) }
})

it('enforces unique pairs, unique order, code foreign keys and assistant cascade', async () => {
  const temp = await createTempDb('paths_constraints'); const pool = createPool(temp.url)
  try {
    await runMigrations(temp.url); const db = drizzle(pool)
    await db.insert(appUser).values({ id: 'u', name: 'Owner', initials: 'O', color: '#123456' })
    await db.insert(codeGroup).values([{ key: 'assistant_level1', name: 'Level 1' }, { key: 'assistant_level2', name: 'Level 2' }])
    await db.insert(code).values([{ id: 'one', groupKey: 'assistant_level1', code: 'one', name: 'One' }, { id: 'two', groupKey: 'assistant_level2', code: 'two', name: 'Two' }, { id: 'three', groupKey: 'assistant_level2', code: 'three', name: 'Three' }])
    await db.insert(assistant).values({ id: 'a', name: 'A', level1CodeId: 'one', level2CodeId: 'two', ownerId: 'u', createdBy: 'u', sortOrder: 1, status: 'open', color: '#123456' })
    const path = { assistantId: 'a', level1CodeId: 'one', level2CodeId: 'two', sortOrder: 0 }
    await db.insert(assistantClassification).values(path)
    await expect(db.insert(assistantClassification).values({ ...path, sortOrder: 1 })).rejects.toMatchObject({ cause: { errno: 1062 } })
    await expect(db.insert(assistantClassification).values({ ...path, level2CodeId: 'three' })).rejects.toMatchObject({ cause: { errno: 1062 } })
    await expect(db.insert(assistantClassification).values({ ...path, level2CodeId: 'missing', sortOrder: 1 })).rejects.toMatchObject({ cause: { errno: 1452 } })
    await expect(db.delete(code).where(eq(code.id, 'two'))).rejects.toMatchObject({ cause: { errno: 1451 } })
    await db.delete(assistant).where(eq(assistant.id, 'a'))
    expect(await db.select().from(assistantClassification)).toEqual([])
  } finally { await pool.end(); await temp.drop() }
})
