import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appUser, assistant, fileObject, message, messageAttachment, task, taskInput, thread } from '../db/schema.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { createTempDb } from '../test/tempDb.js'
import { DbTasksService } from './tasks.service.js'
import { DbFilesService } from '../files/files.service.js'
import { FileStorageService } from '../files/fileStorage.service.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

  it('serializes deleting a source task with selecting its file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mes-race-'))
    try {
      const files = new DbFilesService(db, new FileStorageService(root), { fileMaxBytes: 1024, fileMaxPerRequest: 2 } as never)
      for (let index = 0; index < 5; index++) {
        const source = (await service.create('member', { assistantId, tags: ['race'] })).task
        const consumer = (await service.create('member', { assistantId, tags: ['race'] })).task
        const file = await files.upload('member', source.id, `race-${index}.txt`, 'text/plain', Buffer.from('x'))
        const [deletion, selection] = await Promise.allSettled([service.delete(source.id), files.setInput('member', consumer.id, file.id, 'main')])
        const accepted = (deletion.status === 'rejected' && deletion.reason?.status === 409 && selection.status === 'fulfilled')
          || (deletion.status === 'fulfilled' && selection.status === 'rejected' && [400, 404].includes(selection.reason?.status))
        expect(accepted).toBe(true)
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects unknown owner and assignee IDs without an internal database error', async () => {
    const { task: created } = await service.create('member', { assistantId })
    await expect(service.update('member', created.id, { ownerId: 'missing-user' })).rejects.toMatchObject({ status: 400 })
    await expect(service.update('member', created.id, { assigneeIds: ['missing-user'] })).rejects.toMatchObject({ status: 400 })
  })

  it('creates the first discussion and activity atomically, and leaves an empty thread when omitted', async () => {
    const withMessage = await service.create('member', { assistantId, firstMessage: ' 첫 의견 ' })
    expect(await service.messages(withMessage.thread.id)).toMatchObject([{ seq: 1, content: '첫 의견', kind: 'discussion', authorId: 'member' }])
    expect((await service.activity(withMessage.task.id)).map((item) => item.type)).toContain('message.sent')
    const withoutMessage = await service.create('member', { assistantId })
    expect(await service.messages(withoutMessage.thread.id)).toEqual([])
  })

  it('records a one-shot file on a discussion message without selecting it as task input', async () => {
    const { task: created, thread: createdThread } = await service.create('member', { assistantId })
    await db.insert(fileObject).values({ id: 'one-shot', kind: 'task_file', originTaskId: created.id, originalName: 'note.txt', mime: 'text/plain', sizeBytes: 1, sha256: 'a'.repeat(64), storageKey: `test/${created.id}/one-shot`, source: 'upload', version: 1, uploadedBy: 'member' })
    const sent = await service.appendMessage('member', createdThread.id, { content: '', kind: 'discussion', attachmentIds: ['one-shot'] })
    expect(sent).toMatchObject({ attachmentIds: ['one-shot'] })
    expect(await db.select().from(messageAttachment).where(eq(messageAttachment.messageId, sent!.id))).toHaveLength(1)
    expect((await service.get(created.id)).inputs).toEqual([])
    await expect(service.appendMessage('member', createdThread.id, { content: '', kind: 'discussion', attachmentIds: ['missing'] })).rejects.toMatchObject({ status: 400 })
  })

  it('rejects completed edits and serializes completion with tag changes', async () => {
    const { task: created, thread: createdThread } = await service.create('member', { assistantId })
    await service.setStatus('member', created.id, 'done')
    await expect(service.update('member', created.id, { summary: 'late' })).rejects.toMatchObject({ status: 409 })
    await expect(service.addTag('member', created.id, 'late')).rejects.toMatchObject({ status: 409 })
    await expect(service.removeTag('member', created.id, 'late')).rejects.toMatchObject({ status: 409 })
    await expect(service.appendMessage('member', createdThread.id, { content: 'late', kind: 'discussion' })).rejects.toMatchObject({ status: 409 })

    for (let index = 0; index < 5; index++) {
      const { task: racing } = await service.create('member', { assistantId })
      const outcomes = await Promise.allSettled([service.setStatus('member', racing.id, 'done'), service.addTag('member', racing.id, `race-${index}`)])
      expect(outcomes[0]?.status).toBe('fulfilled')
      if (outcomes[1]?.status === 'rejected') expect(outcomes[1].reason).toMatchObject({ status: 409 })
      expect((await service.get(racing.id)).status).toBe('done')
      const hasTag = (await service.get(racing.id)).tags.includes(`race-${index}`)
      expect(hasTag).toBe(outcomes[1]?.status === 'fulfilled')
    }
  })

  it('filters by SQL criteria and assembles list items like get', async () => {
    const first = (await service.create('member', { assistantId, tags: ['filter-one'] })).task
    const second = (await service.create('member', { assistantId, tags: ['filter-two'] })).task
    await db.insert(appUser).values({ id: 'assignee', name: 'Assignee', initials: 'A', color: '#123456' }).onConflictDoNothing()
    await service.update('member', first.id, { assigneeIds: ['assignee'] })
    await service.setStatus('member', second.id, 'done')
    expect((await service.list({ assistantId, status: ['in_progress'], tags: ['filter-one'], mine: 'member' })).find((item) => item.id === first.id)).toEqual(await service.get(first.id))
    expect((await service.list({ mine: 'assignee', tags: ['filter-one'] })).map((item) => item.id)).toContain(first.id)
    expect((await service.list({ mine: 'assignee', tags: ['filter-two'] })).map((item) => item.id)).not.toContain(second.id)
    expect((await service.list({ status: ['done'], tags: ['filter-one'] })).some((item) => item.id === first.id)).toBe(false)
    expect((await service.list({ assistantId: 'missing' })).some((item) => item.id === first.id)).toBe(false)
    expect((await service.list({ mine: 'missing' })).some((item) => item.id === first.id)).toBe(false)
    expect((await service.list({ tags: ['filter-two'] })).some((item) => item.id === second.id)).toBe(true)
    expect((await service.list({ tags: ['filter-one', 'filter-two'] })).some((item) => item.id === first.id || item.id === second.id)).toBe(false)
  })

  it('uses a constant number of queries for the list', async () => {
    let queries = 0
    const counted = new DbTasksService(drizzle(client, { logger: { logQuery: () => { queries++ } } }))
    await counted.list()
    expect(queries).toBeLessThanOrEqual(4)
  })

  it('keeps the thread when a task has no assignees', async () => {
    const created = await service.create('member', { assistantId })
    await service.update('member', created.task.id, { assigneeIds: [] })
    expect(await service.get(created.task.id)).toMatchObject({ assigneeIds: [], threadId: created.thread.id })
  })

  it('advances lastActivityAt when a tag is removed', async () => {
    const { task: created } = await service.create('member', { assistantId, tags: ['remove-me'] })
    const before = new Date('2020-01-01T00:00:00.000Z')
    await db.update(task).set({ lastActivityAt: before }).where(eq(task.id, created.id))
    await service.removeTag('member', created.id, 'remove-me')
    expect(new Date((await service.get(created.id)).lastActivityAt).getTime()).toBeGreaterThan(before.getTime())
  })
})
