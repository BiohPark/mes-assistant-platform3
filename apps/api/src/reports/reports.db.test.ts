import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/mysql2'
import { eq } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'
import type { Db } from '../db/db.module.js'
import { createPool } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { activityLog, appUser, assistant, task } from '../db/schema.js'
import { createTempDb } from '../test/tempDb.js'
import { DbTasksService } from '../tasks/tasks.service.js'
import { ReportsService } from './reports.service.js'

describe('reports DB', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  let db: Db
  let reports: ReportsService
  let tasks: DbTasksService
  beforeAll(async () => {
    temp = await createTempDb('reports')
    await runMigrations(temp.url)
    client = createPool(temp.url)
    db = drizzle(client)
    await seedCatalog(db)
    await db.insert(appUser).values({ id: 'reporter', name: '리포터', initials: '리', color: '#000' })
    tasks = new DbTasksService(db)
    reports = new ReportsService(db, tasks)
  })
  afterAll(async () => { await client?.end(); await temp?.drop() })

  it('완료 이벤트 시각으로 집계하고 삭제 업무를 제외한다', async () => {
    const [selected] = await db.select().from(assistant)
    const completed = (await tasks.create('reporter', { assistantId: selected!.id, tags: ['리포트'] })).task
    const removed = (await tasks.create('reporter', { assistantId: selected!.id, tags: ['제외'] })).task
    await db.update(task).set({ status: 'done', completedAt: new Date('2020-01-01') }).where(eq(task.id, completed.id))
    await db.update(task).set({ deletedAt: new Date() }).where(eq(task.id, removed.id))
    await db.insert(activityLog).values({ id: 'report-complete', taskId: completed.id, userId: 'reporter', type: 'task.completed', payload: {} })
    await db.insert(activityLog).values({ id: 'report-removed', taskId: removed.id, userId: 'reporter', type: 'task.reopened', payload: {} })
    const result = await reports.get(7, 'day')
    expect(result.buckets.reduce((total, row) => total + row.done, 0)).toBe(1)
    expect(result.kpi.done).toBe(1)
    expect(result.kpi.reopens).toBe(0)
    expect(result.tags.map((row) => row.tag)).toContain('리포트')
    expect(result.tags.map((row) => row.tag)).not.toContain('제외')
    expect(result.assistantStats.find((row) => row.assistant.id === selected!.id)?.total).toBe(1)
    const filtered = await reports.get(7, 'day', 'nobody')
    expect(filtered.kpi.done).toBe(0)
    expect(filtered.assistantStats).toHaveLength(0)
  })
})
