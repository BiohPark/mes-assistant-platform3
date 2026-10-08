import { afterAll, beforeAll, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/mysql2'
import type { Pool } from 'mysql2/promise'
import { eq } from 'drizzle-orm'
import { createPool } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { createTempDb } from '../test/tempDb.js'
import { appUser, code } from '../db/schema.js'
import { AdminService } from './admin.service.js'
import { DbCatalogReader } from '../catalog/catalog.service.js'

let temp: Awaited<ReturnType<typeof createTempDb>>
let pool: Pool
let admin: AdminService
let catalog: DbCatalogReader
beforeAll(async () => {
  temp = await createTempDb('classifications'); await runMigrations(temp.url)
  pool = createPool(temp.url); const db = drizzle(pool); await seedCatalog(db)
  await db.insert(appUser).values({ id: 'classification-owner', name: 'Owner', initials: 'O', color: '#123456' })
  admin = new AdminService(db); catalog = new DbCatalogReader(db)
})
afterAll(async () => { await pool?.end(); await temp?.drop() })
const fields = { name: 'Paths', summary: '', ownerId: 'classification-owner', status: 'open' as const, usageExample: '', expectedInputs: [], expectedOutputs: [], checklistTemplate: [] }
const first = { level1CodeId: 'assistant_level1:SDLC', level2CodeId: 'assistant_level2:분석' }
const second = { level1CodeId: 'assistant_level1:Record', level2CodeId: 'assistant_level2:Deviation' }
// Additional fields deliberately exercise the service boundary before its types are extended.
const create = (id: string, classifications: unknown[]) => admin.createAssistant('classification-owner', { ...fields, id, classifications } as Parameters<AdminService['createAssistant']>[1])
const update = (id: string, classifications: unknown[]) => admin.updateAssistant(id, { classifications } as Parameters<AdminService['updateAssistant']>[1])
const view = async (id: string) => (await catalog.assistants()).find(row => row.id === id) as unknown as { classifications: Array<{ level1CodeId: string; level2CodeId: string; level1: string; level2: string }>; level1CodeId: string; level2CodeId: string }

it('stores ordered paths and derives the representative fields; concurrent replacement stays whole', async () => {
  await create('multi', [first, second])
  expect((await view('multi')).classifications).toEqual([{ ...first, level1: 'SDLC', level2: '분석' }, { ...second, level1: 'Record', level2: 'Deviation' }])
  await update('multi', [second, first])
  expect(await view('multi')).toMatchObject({ ...second, classifications: [{ ...second }, { ...first }] })
  await Promise.all([update('multi', [first, second]), update('multi', [second, first])])
  const item = await view('multi')
  expect(item.classifications).toHaveLength(2)
  expect(item).toMatchObject({ level1CodeId: item.classifications[0]!.level1CodeId, level2CodeId: item.classifications[0]!.level2CodeId })
})
it('rejects zero paths and duplicates after normalized name/ID resolution atomically', async () => {
  await expect(create('empty', [])).rejects.toMatchObject({ status: 400 })
  await expect(create('duplicate', [first, { level1: ' sdlc ', level2: '분석' }])).rejects.toMatchObject({ status: 400 })
  await expect(update('multi', [])).rejects.toMatchObject({ status: 400 })
  expect((await view('multi')).classifications).toHaveLength(2)
})
it('preserves inactive existing paths by ID while refusing new inactive selections', async () => {
  const db = drizzle(pool)
  await db.update(code).set({ active: false }).where(eq(code.id, second.level2CodeId))
  await update('multi', [second, first])
  expect((await view('multi')).classifications[0]).toMatchObject(second)
  await expect(create('inactive-new', [second])).rejects.toMatchObject({ status: 400 })
  await db.update(code).set({ active: true }).where(eq(code.id, second.level2CodeId))
})
it('cleans only unreferenced automatic codes across every path, including deletion', async () => {
  const auto = { level1: 'Automatic group', level2: 'Automatic child' }
  await create('auto-one', [first, auto]); await create('auto-two', [second, auto])
  await update('auto-one', [first])
  expect((await admin.codes(undefined, true)).some(row => row.name === auto.level2)).toBe(true)
  await admin.deleteAssistant('auto-two')
  const codes = await admin.codes(undefined, true)
  expect(codes.some(row => row.name === auto.level1 || row.name === auto.level2)).toBe(false)
  expect(codes.some(row => row.id === second.level2CodeId)).toBe(true)
})
it('seeds exactly two assistants with two paths and preserves them on rerun', async () => {
  const before = (await catalog.assistants()).filter(row => row.id !== 'multi' && row.id !== 'auto-one') as unknown as Array<{ classifications: unknown[] }>
  expect(before.filter(row => row.classifications?.length === 2)).toHaveLength(2)
  await seedCatalog(drizzle(pool))
  expect((await view('multi')).classifications[0]).toMatchObject(second)
})


it('legacy representative PATCH preserves strict ID pairs for every secondary path', async () => {
  await create('legacy-multi', [first, second])
  await admin.updateAssistant('legacy-multi', { name: 'Saved by legacy editor', ...first })
  expect((await view('legacy-multi')).classifications).toEqual([{ ...first, level1: 'SDLC', level2: '분석' }, { ...second, level1: 'Record', level2: 'Deviation' }])
})
