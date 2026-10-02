import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/mysql2'
import { count } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'
import { createPool } from './connection.js'
import { runMigrations } from './migrate.js'
import { activityLog, fileObject, message, serviceRequest, task } from './schema.js'
import { createTempDb } from '../test/tempDb.js'
import { seedScale } from './seedScale.js'

describe('규모 시드', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  beforeAll(async () => { temp = await createTempDb('scale'); await runMigrations(temp.url); client = createPool(temp.url) })
  afterAll(async () => { await client?.end(); await temp?.drop() })
  it('업무·메시지·파일 메타·SR·활동 이력을 지정 수량으로 만든다', async () => {
    const db = drizzle(client)
    await seedScale(db, { tasks: 2, files: 3, srs: 1 })
    expect((await db.select({ n: count() }).from(task))[0]?.n).toBe(2)
    expect((await db.select({ n: count() }).from(message))[0]?.n).toBe(4)
    expect((await db.select({ n: count() }).from(fileObject))[0]?.n).toBe(3)
    expect((await db.select({ n: count() }).from(serviceRequest))[0]?.n).toBe(1)
    expect((await db.select({ n: count() }).from(activityLog))[0]?.n).toBeGreaterThanOrEqual(3)
    await expect(seedScale(db, { tasks: 2, files: 3, srs: 1 })).rejects.toThrow(/이미/)
  })
})
