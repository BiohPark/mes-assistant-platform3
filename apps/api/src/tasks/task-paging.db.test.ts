import { drizzle } from 'drizzle-orm/mysql2'
import type { Pool } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createPool } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { appUser, assistant, chatRequest, checklistItem, fileObject, message, serviceRequest, tag, task, taskAssignee, taskInput, taskTag, thread } from '../db/schema.js'
import { createTempDb, MIGRATION_TEST_TIMEOUT_MS } from '../test/tempDb.js'
import { DbTasksService } from './tasks.service.js'

describe('task paging and query budgets', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  let service: DbTasksService
  let assistantIds: string[]
  const queries: string[] = []
  beforeAll(async () => {
    temp = await createTempDb('paging')
    await runMigrations(temp.url)
    client = createPool(temp.url)
    const db = drizzle(client)
    await seedCatalog(db)
    await db.insert(appUser).values([
      { id: 'reader', name: 'Reader', initials: 'R', color: '#000' },
      { id: 'bo', name: 'BO', initials: 'B', color: '#000', isBusinessOwner: true },
      { id: 'so', name: 'SO', initials: 'S', color: '#000', isBusinessOwner: true, isSystemOwner: true },
    ])
    assistantIds = (await db.select().from(assistant).limit(2)).map(row => row.id)
    await db.insert(serviceRequest).values({ id: 'sr', code: 'SR-2099-0001', requesterId: 'reader', titleSource: 'manual', status: 'submitted' })
    await db.insert(task).values(Array.from({ length: 500 }, (_, i) => ({
      id: `page-${String(i).padStart(3, '0')}`, code: `PAGE-${i}`, assistantId: assistantIds[i % 2]!, title: i === 0 ? 'Unique title' : `Task ${i}`,
      titleSource: 'manual', summary: 'large detail '.repeat(500), status: i % 3 === 0 ? 'done' : 'in_progress',
      ownerId: i === 0 ? 'bo' : 'reader', createdBy: i === 1 ? 'bo' : 'reader', srId: i === 0 ? 'sr' : null,
      priority: 'normal', lastActivityAt: new Date('2026-10-15T00:00:00.000Z'), deletedAt: i === 499 ? new Date() : null,
    })))
    // Sub-millisecond timestamps must survive cursor round-trips.
    await client.query("update task set last_activity_at = '2026-10-15 00:00:00.000123'")
    await db.insert(thread).values(Array.from({ length: 500 }, (_, i) => ({ id: `th-${i}`, taskId: `page-${String(i).padStart(3, '0')}`, title: 'Thread', createdBy: 'reader' })))
    await db.insert(taskAssignee).values({ taskId: 'page-002', userId: 'bo' })
    await db.insert(tag).values([{ key: 'needle', label: 'Needle', kind: 'keyword' }, { key: 'sr-2099-0001', label: 'SR-2099-0001', kind: 'sr' }])
    await db.insert(taskTag).values([
      { taskId: 'page-000', tagKey: 'needle', addedBy: 'reader' },
      { taskId: 'page-002', tagKey: 'sr-2099-0001', addedBy: 'reader' },
      { taskId: 'page-499', tagKey: 'needle', addedBy: 'reader' },
    ])
    await db.insert(checklistItem).values([{ id: 'c1', taskId: 'page-000', sortOrder: 0, label: 'long checklist', checked: true }, { id: 'c2', taskId: 'page-000', sortOrder: 1, label: 'other', checked: false }])
    await db.insert(fileObject).values({ id: 'output', originTaskId: 'page-000', originalName: 'x', mime: 'text/plain', sizeBytes: 1, sha256: 'a'.repeat(64), storageKey: 'x', kind: 'task_file', version: 1, source: 'assistant', uploadedBy: 'reader', isOutput: true })
    await db.insert(taskInput).values({ taskId: 'page-000', fileId: 'output', weight: 'main', sortOrder: 0, selectedBy: 'reader' })
    service = new DbTasksService(drizzle(client, { logger: { logQuery: query => queries.push(query) } }))
  }, MIGRATION_TEST_TIMEOUT_MS)
  afterAll(async () => { await client?.end(); await temp?.drop() })

  it('pages timestamp ties without duplicates, defaults to 30, preserves legacy detail and summarizes without detail joins', async () => {
    const legacy = await service.list({}, 'reader')
    expect(legacy).toHaveLength(499)
    expect(legacy.find(row => row.id === 'page-000')?.checklist).toHaveLength(2)
    expect((await service.listPage({ view: 'summary' }, 'reader')).items).toHaveLength(30)
    let cursor: string | undefined
    const ids: string[] = []
    do {
      queries.length = 0
      const page = await service.listPage({ view: 'summary', limit: 200, cursor }, 'reader')
      expect(queries.length).toBeLessThanOrEqual(4)
      expect(queries.some(query => /join `checklist|join `task_feedback|join `file_object|`summary`/.test(query))).toBe(false)
      ids.push(...page.items.map(row => row.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(ids).toHaveLength(499)
    expect(new Set(ids).size).toBe(499)
    expect(ids[0]).toBe('page-498')
    const detailPage = await service.listPage({ limit: 1 }, 'reader')
    expect(detailPage.items[0]).toHaveProperty('summary')
    expect((await service.listPage({ limit: 1, cursor: detailPage.nextCursor! }, 'reader')).items[0]?.id).not.toBe(detailPage.items[0]?.id)
    const { items } = await service.listPage({ view: 'summary', q: 'unique TITLE' }, 'reader')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'page-000', checklist: { checked: 1, total: 2 }, inputCount: 1, outputCount: 1, tags: ['Needle'], linkedSrCodes: ['SR-2099-0001'], threadId: 'th-0', aiRequest: null })
    for (const key of ['summary', 'inputs', 'outputFileIds', 'thread', 'feedback', 'checklistReview']) expect(items[0]).not.toHaveProperty(key)
    expect((await service.listPage({ view: 'summary', q: 'needle' }, 'reader')).items.map(row => row.id)).toEqual(['page-000'])
    expect((await service.listPage({ q: 'PAGE-499' }, 'reader')).items).toEqual([])
    await expect(service.listPage({ cursor: 'bad' }, 'reader')).rejects.toMatchObject({ status: 400 })
  })

  it('applies the same filters and BO scope to board items and totals with a constant query budget', async () => {
    for (const [actor, total] of [['bo', 3], ['so', 499], ['reader', 499]] as const) {
      queries.length = 0
      const board = await service.board({ limit: 2 }, actor)
      expect(queries.length).toBeLessThanOrEqual(6)
      expect(board.columns.reduce((n, column) => n + column.total, 0)).toBe(total)
      expect(board.columns.every(column => column.items.length <= 2)).toBe(true)
    }
    const first = (await service.board({ assistantId: assistantIds[0], limit: 2 }, 'reader')).columns[0]!
    const next = (await service.board({ assistantId: first.assistantId, limit: 2, cursor: first.nextCursor! }, 'reader')).columns[0]!
    expect(next.total).toBe(first.total)
    expect(next.items).toHaveLength(2)
    expect(next.items.some(item => first.items.some(previous => previous.id === item.id))).toBe(false)
    expect((await service.board({ assistantId: assistantIds[0], tags: ['NEEDLE'] }, 'reader')).columns[0]?.total).toBe(1)
    const own = await service.board({ mine: 'bo', status: ['done'] }, 'bo')
    expect(own.columns.reduce((n, column) => n + column.total, 0)).toBe(1)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-16T00:00:00Z'))
    try {
      expect((await service.listPage({ activeWithinDays: 1, q: 'PAGE-0' }, 'reader')).items).toHaveLength(1)
      expect((await service.board({ activeWithinDays: 0 }, 'reader')).columns.every(column => column.total === 0)).toBe(true)
    } finally { vi.useRealTimers() }
    const filtered = await service.board({ q: 'needle', ai: ['none'] }, 'bo')
    expect(filtered.columns.flatMap(column => column.items).map(row => row.id)).toEqual(['page-000'])
    expect(filtered.columns.reduce((n, column) => n + column.total, 0)).toBe(1)
    expect((await service.listPage({ ai: ['failed'] }, 'reader')).items).toEqual([])
    const tags = await service.listPage({ view: 'summary', q: 'SR-2099-0001' }, 'reader')
    expect(tags.items[0]).toMatchObject({ linkedSrCodes: ['SR-2099-0001'] })
    const db = drizzle(client)
    await db.update(task).set({ lastActivityAt: new Date('2020-01-01') }).where(eq(task.id, 'page-000'))
    expect((await service.board({ q: 'needle', activeWithinDays: 30 }, 'bo')).columns.every(column => column.total === 0)).toBe(true)
  })

  it('filters on the representative AI request: active first, otherwise latest including successful requests', async () => {
    const db = drizzle(client)
    const rows = [
      { id: 'old-active', threadId: 'th-001', status: 'streaming', at: '2026-10-01' },
      { id: 'new-failure', threadId: 'th-001', status: 'failed', at: '2026-10-02' },
      { id: 'old-failure', threadId: 'th-003', status: 'failed', at: '2026-10-01' },
      { id: 'new-success', threadId: 'th-003', status: 'succeeded', at: '2026-10-02' },
      { id: 'new-interrupted', threadId: 'th-005', status: 'interrupted', at: '2026-10-02' },
      { id: 'pending', threadId: 'th-007', status: 'pending', at: '2026-10-02' },
    ].map(row => ({ ...row, threadId: `th-${Number(row.threadId.slice(3))}` }))
    for (const row of rows) {
      await db.insert(message).values([
        { id: `${row.id}-u`, threadId: row.threadId, seq: row.at === '2026-10-01' ? 1 : 3, role: 'user', content: 'question', status: 'done' },
        { id: `${row.id}-r`, threadId: row.threadId, seq: row.at === '2026-10-01' ? 2 : 4, role: 'assistant', content: 'answer', status: 'done' },
      ])
      await db.insert(chatRequest).values({ id: row.id, threadId: row.threadId, userMessageId: `${row.id}-u`, replyMessageId: `${row.id}-r`, status: row.status,
        requestedBy: 'reader', provider: 'mock', transport: 'inline', model: 'mock', bytes: 0, limitBytes: 1, createdAt: new Date(row.at), phase: 'working' })
    }
    expect((await service.listPage({ view: 'summary', ai: ['responding'] }, 'reader')).items.map(item => item.id)).toEqual(['page-007', 'page-001'])
    expect((await service.listPage({ view: 'summary', ai: ['failed'] }, 'reader')).items.map(item => item.id)).toEqual(['page-005'])
    expect((await service.listPage({ view: 'summary', ai: ['streaming'] }, 'reader')).items[0]).toMatchObject({ id: 'page-001', aiRequest: { status: 'streaming', phase: 'working' } })
    const none = await service.listPage({ view: 'summary', limit: 200, q: 'PAGE-3', ai: ['none'] }, 'reader')
    expect(none.items.some(item => item.id === 'page-003')).toBe(true)
    const bo = await service.board({ ai: ['responding', 'failed'] }, 'bo')
    expect(bo.columns.flatMap(column => column.items).map(item => item.id)).toEqual(['page-001'])
    expect(bo.columns.reduce((total, column) => total + column.total, 0)).toBe(1)
  })

  it('suggests tags using SQL counts without assembling tasks, excluding deleted and invisible tasks', async () => {
    const list = vi.spyOn(service, 'list')
    queries.length = 0
    const result = await service.suggestions('bo', 'needle')
    expect(result).toEqual({ items: [{ tag: 'Needle', count: 1, isSr: false }], srScope: 'partial' })
    expect(list).not.toHaveBeenCalled()
    expect(queries.length).toBeLessThanOrEqual(3)
    expect(queries.some(query => /checklist|file_object|chat_request/.test(query))).toBe(false)
    expect((await service.suggestions('bo', 'needle', ['NEEDLE'])).items).toEqual([])
  })
})
