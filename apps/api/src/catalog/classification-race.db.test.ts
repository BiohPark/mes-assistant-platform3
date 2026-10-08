import { expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/mysql2'
import { createTempDb } from '../test/tempDb.js'
import { createPool } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { appUser } from '../db/schema.js'
import { AdminService } from '../admin/admin.service.js'
import { DbCatalogReader } from './catalog.service.js'

it('reads an assistant and all its paths from one snapshot during concurrent deletion', async () => {
  const temp = await createTempDb('paths_read_race'); const pool = createPool(temp.url)
  const query = pool.query.bind(pool)
  const forward = query as PoolQuery
  try {
    await runMigrations(temp.url); const db = drizzle(pool); await seedCatalog(db)
    await db.insert(appUser).values({ id: 'reader-owner', name: 'Owner', initials: 'O', color: '#123456' })
    const admin = new AdminService(db)
    await admin.createAssistant('reader-owner', { id: 'read-race', name: 'Race', classifications: [{ level1CodeId: 'assistant_level1:SDLC', level2CodeId: 'assistant_level2:분석' }], summary: '', ownerId: 'reader-owner', status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [], checklistTemplate: [] })
    let deleted = false
    let signal!: () => void
    const deletion = new Promise<void>(resolve => { signal = resolve })
    pool.query = (async (...args: Parameters<PoolQuery>) => {
      const statement = typeof args[0] === 'string' ? args[0] : args[0].sql
      if (statement.includes('from `assistant_classification`') && !statement.includes(' where ')) {
        await deletion
        return forward(...args)
      }
      const result = await forward(...args)
      if (!deleted && statement.includes('from `assistant`') && !statement.includes(' where ')) {
        deleted = true
        await admin.deleteAssistant('read-race')
        signal()
      }
      return result
    }) as typeof pool.query
    const result = await new DbCatalogReader(db).assistants()
    const agent = result.find(row => row.id === 'read-race')!
    expect(agent.classifications).toEqual([{ level1: 'SDLC', level2: '분석', level1CodeId: 'assistant_level1:SDLC', level2CodeId: 'assistant_level2:분석' }])
  } finally { pool.query = query; await pool.end(); await temp.drop() }
})
type PoolQuery = (options: string | { sql: string }, values?: any) => Promise<any>
