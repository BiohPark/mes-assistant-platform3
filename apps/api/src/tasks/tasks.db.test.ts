import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appUser, assistant, fileObject, message, task, taskInput, thread } from '../db/schema.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { createTempDb } from '../test/tempDb.js'
import { DbTasksService } from './tasks.service.js'

describe('tasks DB', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: postgres.Sql
  let db: ReturnType<typeof drizzle>
  let service: DbTasksService
  let assistantId: string
  beforeAll(async () => {
    temp = await createTempDb('tasks')
    await runMigrations(temp.url)
    client = postgres(temp.url, { onnotice: () => undefined })
    db = drizzle(client)
    await seedCatalog(db)
    await db.insert(appUser).values({ id: 'member', name: 'Member', initials: 'M', color: '#123456' })
    assistantId = (await db.select().from(assistant))[0]!.id
    service = new DbTasksService(db)
  })
  afterAll(async () => { await client?.end(); await temp?.drop() })

  it('creates one thread, normalized tags and unique year codes under concurrency', async () => {
    const created = await Promise.all(Array.from({ length: 10 }, () => service.create('member', { assistantId, tags: ['#sr-2026-0002', 'SR-2026-0002', ' cca item '] })))
    expect(new Set(created.map((item) => item.task.code)).size).toBe(10)
    expect(created.every((item) => /^WK-\d{4}-\d{4}$/.test(item.task.code))).toBe(true)
    expect(created[0]!.task).toMatchObject({ titleSource: 'default', status: 'in_progress', ownerId: 'member', tags: ['SR-2026-0002', 'cca-item'] })
    expect(created[0]!.task.threadId).toBe(created[0]!.thread.id)
    expect(await service.get(created[0]!.task.id)).toMatchObject({ thread: { id: created[0]!.thread.id, taskId: created[0]!.task.id } })
    expect((await service.activity(created[0]!.task.id)).filter((item) => item.type === 'tag.added').map((item) => item.payload)).toEqual(expect.arrayContaining([{ tag: 'SR-2026-0002' }, { tag: 'cca-item' }]))
    expect((await db.select().from(thread).where(eq(thread.taskId, created[0]!.task.id)))).toHaveLength(1)
  })

  it('rejects retired assistants and locks completed task edits until a reasoned reopen', async () => {
    await db.update(assistant).set({ status: 'retired' }).where(eq(assistant.id, assistantId))
    await expect(service.create('member', { assistantId })).rejects.toMatchObject({ status: 409 })
    await db.update(assistant).set({ status: 'open' }).where(eq(assistant.id, assistantId))
    const { task: created } = await service.create('member', { assistantId })
    await service.update('member', created.id, { title: '내 제목' })
    expect(await service.get(created.id)).toMatchObject({ title: '내 제목', titleSource: 'manual' })
    await service.setStatus('member', created.id, 'done')
    await expect(service.update('member', created.id, { summary: '잠긴 수정' })).rejects.toMatchObject({ status: 409 })
    await expect(service.setStatus('member', created.id, 'in_progress')).rejects.toMatchObject({ status: 400 })
    await service.setStatus('member', created.id, 'in_progress', '다시 진행')
    expect((await service.get(created.id)).status).toBe('in_progress')
    expect((await service.get(created.id)).completedAt).toBeUndefined()
    expect((await service.activity(created.id))[0]).toMatchObject({ type: 'task.reopened', payload: { reason: '다시 진행' } })
  })

  it('filters tasks, records discussion messages in sequence and cascades deletion', async () => {
    const { task: created, thread: createdThread } = await service.create('member', { assistantId, tags: ['alpha'] })
    expect((await service.list({ assistantId, tags: ['alpha'], mine: 'member' })).map((item) => item.id)).toContain(created.id)
    expect((await service.list({ status: ['done'], tags: ['alpha'] })).map((item) => item.id)).not.toContain(created.id)
    await service.appendMessage('member', createdThread.id, { content: '첫 의견', kind: 'discussion' })
    await service.appendMessage('member', createdThread.id, { content: '둘째 의견', kind: 'discussion' })
    expect((await service.messages(createdThread.id)).map((item) => [item.seq, item.content, item.kind])).toEqual([[1, '첫 의견', 'discussion'], [2, '둘째 의견', 'discussion']])
    expect((await service.activity(created.id)).some((item) => item.type === 'message.sent')).toBe(true)
    await service.delete(created.id)
    expect(await db.select().from(task).where(eq(task.id, created.id))).toHaveLength(0)
    expect(await db.select().from(thread).where(eq(thread.id, createdThread.id))).toHaveLength(0)
    expect(await db.select().from(message).where(eq(message.threadId, createdThread.id))).toHaveLength(0)
  })

  it('deletes its own file but protects a file selected by another task', async () => {
    const { task: source } = await service.create('member', { assistantId })
    const { task: consumer } = await service.create('member', { assistantId })
    await db.insert(fileObject).values({ id: 'owned-file', kind: 'task_file', originTaskId: source.id, originalName: 'x.txt', mime: 'text/plain', sizeBytes: 1, sha256: 'a'.repeat(64), storageKey: `test/${source.id}`, source: 'upload', version: 1, uploadedBy: 'member' })
    await db.insert(taskInput).values({ taskId: consumer.id, fileId: 'owned-file', weight: 'main', sortOrder: 0, selectedBy: 'member' })
    await expect(service.delete(source.id)).rejects.toMatchObject({ status: 409 })
    await db.delete(taskInput).where(eq(taskInput.taskId, consumer.id))
    await service.delete(source.id)
    expect(await db.select().from(fileObject).where(eq(fileObject.id, 'owned-file'))).toHaveLength(0)
  })

  it('rejects unknown owner and assignee IDs without an internal database error', async () => {
    const { task: created } = await service.create('member', { assistantId })
    await expect(service.update('member', created.id, { ownerId: 'missing-user' })).rejects.toMatchObject({ status: 400 })
    await expect(service.update('member', created.id, { assigneeIds: ['missing-user'] })).rejects.toMatchObject({ status: 400 })
  })
})
