import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/mysql2'
import { eq } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'
import type { Db } from '../db/db.module.js'
import { createPool } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { activityLog, appUser, assistant, fileObject, serviceRequest, task, taskInput } from '../db/schema.js'
import { createTempDb } from '../test/tempDb.js'
import { DbTasksService } from '../tasks/tasks.service.js'
import { EventsService } from '../events/events.service.js'
import { SrService } from '../sr/sr.service.js'
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
    await db.insert(appUser).values([
      { id: 'reporter', name: '리포터', initials: '리', color: '#000' },
      { id: 'requester', name: '요청자', initials: '요', color: '#000', isBusinessOwner: true },
      { id: 'other', name: '다른 담당자', initials: '다', color: '#000' },
      { id: 'system-owner', name: '시스템 소유자', initials: '시', color: '#000', isSystemOwner: true, isBusinessOwner: true },
    ])
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
    const result = await reports.get(7, 'day', 'reporter')
    expect(result.buckets.reduce((total, row) => total + row.done, 0)).toBe(1)
    expect(result.kpi.done).toBe(1)
    expect(result.kpi.reopens).toBe(0)
    expect(result.tags.map((row) => row.tag)).toContain('리포트')
    expect(result.tags.map((row) => row.tag)).not.toContain('제외')
    expect(result.assistantStats.find((row) => row.assistant.id === selected!.id)?.total).toBe(1)
    const filtered = await reports.get(7, 'day', 'reporter', 'nobody')
    expect(filtered.kpi.done).toBe(0)
    expect(filtered.assistantStats).toHaveLength(0)
  })

  it('요청자는 리포트의 전체 업무·SR 집계에 접근할 수 없다', async () => {
    await expect(reports.get(7, 'day', 'requester')).rejects.toMatchObject({ status: 403 })
    await expect(reports.get(7, 'day', 'system-owner')).resolves.toHaveProperty('buckets')
  })

  it('SR 완료 상태 변경 로그로 접수부터 완료까지의 리드타임을 집계한다', async () => {
    const sr = new SrService(db, tasks, new EventsService())
    const draft = await sr.create('requester')
    await sr.submit('requester', draft.id, { title: '리드타임', body: '', attachmentIds: [] })
    await db.update(serviceRequest).set({ submittedAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(serviceRequest.id, draft.id))
    await sr.status('system-owner', draft.id, 'done')
    const logs = await db.select().from(activityLog).where(eq(activityLog.srId, draft.id))
    expect(logs.filter((row) => row.type === 'sr.status_changed')).toContainEqual(expect.objectContaining({ userId: 'system-owner', payload: { from: 'submitted', to: 'done' } }))
    expect((await reports.get(7, 'day', 'reporter')).kpi.srLead).toBe(2)
  })

  it('담당자 필터는 자료 흐름의 대상 업무만 제한하고 출처 업무는 참조한다', async () => {
    const [fromAssistant, toAssistant] = await db.select().from(assistant)
    const source = (await tasks.create('other', { assistantId: fromAssistant!.id })).task
    const mine = (await tasks.create('reporter', { assistantId: toAssistant!.id })).task
    const theirs = (await tasks.create('other', { assistantId: toAssistant!.id })).task
    await db.insert(fileObject).values({ id: 'report-source-file', kind: 'task_file', originTaskId: source.id, originalName: 'source.txt',
      mime: 'text/plain', sizeBytes: 1, sha256: 'a'.repeat(64), storageKey: `test/${source.id}`, source: 'upload', version: 1, uploadedBy: 'other' })
    await db.insert(taskInput).values([mine, theirs].map((consumer, sortOrder) => ({ taskId: consumer.id, fileId: 'report-source-file', weight: 'main' as const, sortOrder, selectedBy: consumer.ownerId })))
    expect((await reports.get(7, 'day', 'reporter')).flow).toContainEqual({ fromAssistantId: fromAssistant!.id, toAssistantId: toAssistant!.id, count: 2 })
    expect((await reports.get(7, 'day', 'reporter', 'reporter')).flow).toContainEqual({ fromAssistantId: fromAssistant!.id, toAssistantId: toAssistant!.id, count: 1 })
  })

  it('전체 기간 활동은 필요한 이벤트·열만 읽고 마지막 활동은 DB에서 집계한다', async () => {
    const queries: string[] = []
    const observed = drizzle(client, { logger: { logQuery: (query) => { queries.push(query) } } })
    await new ReportsService(observed, new DbTasksService(observed)).get(7, 'day', 'reporter')
    const activityQueries = queries.filter((query) => query.includes('from `activity_log`'))
    expect(activityQueries).toHaveLength(3)
    const history = activityQueries.find((query) => query.includes('`activity_log`.`type` in'))
    expect(history).toBeDefined()
    expect(history).not.toContain('`assistant_id`')
    expect(history).not.toContain('`activity_log`.`user_id`')
    expect(history).not.toContain('`activity_log`.`id`')
    expect(activityQueries.some((query) => /max\([^)]*`at`\)/.test(query) && /group by .*`task_id`/.test(query))).toBe(true)
  })

  it('집계 이벤트가 아닌 최근 활동도 방치 판정의 마지막 시각에 반영한다', async () => {
    const [selected] = await db.select().from(assistant)
    const created = (await tasks.create('reporter', { assistantId: selected!.id })).task
    await db.update(task).set({ createdAt: new Date(Date.now() - 10 * 86_400_000), startedAt: new Date(Date.now() - 10 * 86_400_000) }).where(eq(task.id, created.id))
    await db.insert(activityLog).values({ id: 'report-fresh-note', taskId: created.id, userId: 'reporter', type: 'note.added', payload: {}, at: new Date() })
    const result = await reports.get(7, 'day', 'reporter')
    expect(result.signals.some((signal) => signal.taskId === created.id && signal.kind === 'stale')).toBe(false)
    expect(result.signals.some((signal) => signal.taskId === created.id && signal.kind === 'long_task')).toBe(true)
  })
})
