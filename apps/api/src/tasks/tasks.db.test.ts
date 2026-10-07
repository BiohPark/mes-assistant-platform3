import { drizzle } from 'drizzle-orm/mysql2'
import type { Db } from '../db/db.module.js'
import type { Pool } from 'mysql2/promise'
import { createPool } from '../db/connection.js'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appUser, assistant, assistantChecklistTemplate, checklistItem, checklistReview, fileObject, message, messageAttachment, noteAttachment, task, taskInput, thread } from '../db/schema.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { createTempDb } from '../test/tempDb.js'
import { DbTasksService } from './tasks.service.js'
import { TaskExtrasService } from './task-extras.service.js'
import { DbFilesService } from '../files/files.service.js'
import { DbCatalogReader } from '../catalog/catalog.service.js'
import { FileStorageService } from '../files/fileStorage.service.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('tasks DB', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  let db: Db
  let service: DbTasksService
  let extras: TaskExtrasService
  let reportRoot: string
  let assistantId: string
  beforeAll(async () => {
    temp = await createTempDb('tasks')
    await runMigrations(temp.url)
    client = createPool(temp.url)
    db = drizzle(client)
    await seedCatalog(db)
    await db.insert(appUser).values({ id: 'member', name: 'Member', initials: 'M', color: '#123456' })
    assistantId = (await db.select().from(assistant))[0]!.id
    reportRoot = await mkdtemp(join(tmpdir(), 'mes-task-status-'))
    extras = new TaskExtrasService(db, { kind: 'mock' } as never, { runAuxiliary: async () => undefined } as never,
      new FileStorageService(reportRoot), { publish: () => undefined } as never)
    service = new DbTasksService(db, undefined, extras)
  })
  afterAll(async () => { await client?.end(); await temp?.drop(); if (reportRoot) await rm(reportRoot, { recursive: true, force: true }) })

  it('creates one thread, normalized tags and unique year codes under concurrency', async () => {
    const created = await Promise.all(Array.from({ length: 10 }, () => service.create('member', { assistantId, tags: ['#sr-2026-0002', 'SR-2026-0002', ' cca item '] })))
    expect(new Set(created.map((item) => item.task.code)).size).toBe(10)
    expect(created.every((item) => /^WK-\d{4}-\d{4}$/.test(item.task.code))).toBe(true)
    expect(created[0]!.task).toMatchObject({ titleSource: 'default', status: 'in_progress', ownerId: 'member', assigneeIds: ['member'], tags: ['SR-2026-0002', 'cca-item'] })
    expect(created[0]!.task.threadId).toBe(created[0]!.thread.id)
    expect(await service.get(created[0]!.task.id)).toMatchObject({ thread: { id: created[0]!.thread.id, taskId: created[0]!.task.id } })
    expect((await service.activity(created[0]!.task.id)).filter((item) => item.type === 'tag.added').map((item) => item.payload)).toEqual(expect.arrayContaining([{ tag: 'SR-2026-0002' }, { tag: 'cca-item' }]))
    expect((await db.select().from(thread).where(eq(thread.taskId, created[0]!.task.id)))).toHaveLength(1)
  })

  it('copies the assistant checklist template when a conversation starts', async () => {
    const templateId = 'template-copy-test'
    await db.insert(assistantChecklistTemplate).values({ id: templateId, assistantId, sortOrder: 900, label: '검토 완료', required: true })
    try {
      const created = await service.create('member', { assistantId })
      expect(created.task.checklist).toEqual(expect.arrayContaining([expect.objectContaining({ label: '검토 완료', required: true, checked: false })]))
      expect(await db.select().from(checklistItem).where(eq(checklistItem.taskId, created.task.id))).toEqual(expect.arrayContaining([expect.objectContaining({ templateItemId: templateId })]))
    } finally {
      await db.update(checklistItem).set({ templateItemId: null }).where(eq(checklistItem.templateItemId, templateId))
      await db.delete(assistantChecklistTemplate).where(eq(assistantChecklistTemplate.id, templateId))
    }
  })

  it('keeps AI review separate from checks and applies only met items', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mes-checklist-'))
    try {
      const extras = new TaskExtrasService(db, { kind: 'mock' } as never,
        { runAuxiliary: async (_actor: string, _kind: string, operation: (signal: AbortSignal) => Promise<unknown>) => operation(new AbortController().signal) } as never,
        new FileStorageService(root), { publish: () => undefined } as never)
      const created = (await service.create('member', { assistantId })).task
      await extras.addChecklist('member', created.id, '첫 항목')
      await extras.addChecklist('member', created.id, '둘째 항목')
      const [first, second] = (await extras.checklist('member', created.id)).filter((item) => item.label === '첫 항목' || item.label === '둘째 항목')
      await extras.toggleChecklist('member', created.id, first!.id)
      const review = await extras.review('member', created.id)
      expect(review).toMatchObject({ met: 1, total: created.checklist.length + 2, source: 'rule' })
      expect((await extras.checklist('member', created.id)).filter((item) => item.id === first!.id || item.id === second!.id).map((item) => item.checked)).toEqual([true, false])
      expect(await extras.applyReview('member', created.id)).toEqual({ applied: 0 })
      await extras.toggleChecklist('member', created.id, first!.id)
      expect(await extras.applyReview('member', created.id)).toEqual({ applied: 1 })
      expect((await extras.checklist('member', created.id)).filter((item) => item.id === first!.id || item.id === second!.id).map((item) => item.checked)).toEqual([true, false])
      expect((await service.activity(created.id)).map((item) => item.type)).toEqual(expect.arrayContaining(['checklist.reviewed', 'checklist.checked', 'checklist.unchecked']))
      await extras.removeChecklist('member', created.id, second!.id)
      expect(await extras.checklist('member', created.id)).toHaveLength(created.checklist.length + 1)
      expect((await service.get(created.id)).checklistReview).toBeUndefined()
      expect(await db.select().from(checklistReview).where(eq(checklistReview.taskId, created.id))).toHaveLength(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('stores note file references and completes with a report, feedback and locked edits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mes-complete-'))
    try {
      const storage = new FileStorageService(root)
      const extras = new TaskExtrasService(db, { kind: 'mock' } as never, { runAuxiliary: async () => undefined } as never,
        storage, { publish: () => undefined } as never)
      const created = (await service.create('member', { assistantId })).task
      const files = new DbFilesService(db, storage, { fileMaxBytes: 1024, fileMaxPerRequest: 2 } as never)
      const input = await files.upload('member', created.id, '근거.txt', 'text/plain', Buffer.from('근거'))
      await files.setInput('member', created.id, input.id, 'main')
      const added = await extras.addNote('member', created.id, '검토 메모', [input.id])
      expect((await extras.notes('member', created.id))[0]).toMatchObject({ content: '검토 메모', attachmentIds: [input.id] })
      expect(await db.select().from(noteAttachment).where(eq(noteAttachment.noteId, added.id))).toHaveLength(1)
      const preview = await extras.preview('member', created.id, { rating: 4, comment: '좋음' })
      expect(preview.content).toContain('근거.txt v1')
      expect(preview.content).toContain('근거.txt v1 ← 이 대화')
      await extras.complete('member', created.id, { rating: 4, comment: '좋음' })
      const done = await service.get(created.id)
      expect(done).toMatchObject({ status: 'done', feedback: { rating: 4, comment: '좋음' } })
      const [report] = await db.select().from(fileObject).where(and(eq(fileObject.originTaskId, created.id), eq(fileObject.isOutput, true)))
      expect(report).toMatchObject({ kind: 'task_file', originalName: `완료리포트_${created.code}.md`, version: 1 })
      const content = Buffer.from(await storage.read(report!.storageKey)).toString('utf8')
      expect(content).toContain('근거.txt v1')
      expect(content).toContain('★ 4 — 좋음')
      expect(content).toContain(`_생성: `)
      await expect(extras.addNote('member', created.id, '늦은 메모')).rejects.toMatchObject({ status: 409 })
      await service.setStatus('member', created.id, 'in_progress', '추가 작업')
      await extras.deleteNote('member', created.id, added.id)
      expect(await extras.notes('member', created.id)).toEqual([])
      await extras.complete('member', created.id)
      const reports = await db.select().from(fileObject).where(and(eq(fileObject.originTaskId, created.id), eq(fileObject.originalName, `완료리포트_${created.code}.md`)))
      expect(reports).toEqual(expect.arrayContaining([expect.objectContaining({ version: 2, previousId: report!.id, isOutput: true })]))
      expect(reports.find((file) => file.id === report!.id)?.isOutput).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('uses an optional idempotency key to return one draft under retries', async () => {
    const first = await service.create('member', { assistantId }, 'same-draft')
    const second = await service.create('member', { assistantId }, 'same-draft')
    expect(second.task.id).toBe(first.task.id)
    expect(second.thread.id).toBe(first.thread.id)
  })

  it('rejects tag keys and draft idempotency keys beyond the column limit', async () => {
    await expect(service.create('member', { assistantId, tags: ['x'.repeat(192)] })).rejects.toMatchObject({ status: 400 })
    await expect(service.create('member', { assistantId }, 'x'.repeat(192))).rejects.toMatchObject({ status: 400 })
    const created = await service.create('member', { assistantId })
    await expect(service.addTag('member', created.task.id, 'x'.repeat(192))).rejects.toMatchObject({ status: 400 })
  })

  it('rejects retired assistants and locks completed task edits until a reasoned reopen', async () => {
    await db.update(assistant).set({ status: 'retired' }).where(eq(assistant.id, assistantId))
    await expect(service.create('member', { assistantId })).rejects.toMatchObject({ status: 409 })
    await db.update(assistant).set({ status: 'open' }).where(eq(assistant.id, assistantId))
    const { task: created } = await service.create('member', { assistantId })
    await service.update('member', created.id, { title: '내 제목' })
    expect(await service.get(created.id)).toMatchObject({ title: '내 제목', titleSource: 'manual' })
    await service.setStatus('member', created.id, 'done')
    const [report] = await db.select().from(fileObject).where(and(eq(fileObject.originTaskId, created.id), eq(fileObject.isOutput, true)))
    expect(report).toMatchObject({ originalName: `완료리포트_${created.code}.md`, version: 1 })
    expect(Buffer.from(await new FileStorageService(reportRoot).read(report!.storageKey)).toString('utf8')).toContain(created.code)
    await expect(service.update('member', created.id, { summary: '잠긴 수정' })).rejects.toMatchObject({ status: 409 })
    await expect(service.setStatus('member', created.id, 'in_progress')).rejects.toMatchObject({ status: 400 })
    await service.setStatus('member', created.id, 'in_progress', '다시 진행')
    expect((await service.get(created.id)).status).toBe('in_progress')
    expect((await service.get(created.id)).completedAt).toBeUndefined()
    expect((await service.activity(created.id))[0]).toMatchObject({ type: 'task.reopened', payload: { reason: '다시 진행' } })
  })

  it('filters tasks, records discussion messages and retains a soft-deleted task', async () => {
    const stats = new DbCatalogReader(db)
    const before = (await stats.stats()).find((item) => item.assistantId === assistantId)!.inProgress
    const { task: created, thread: createdThread } = await service.create('member', { assistantId, tags: ['alpha'] })
    expect((await stats.stats()).find((item) => item.assistantId === assistantId)!.inProgress).toBe(before + 1)
    expect((await service.list({ assistantId, tags: ['alpha'], mine: 'member' })).map((item) => item.id)).toContain(created.id)
    expect((await service.list({ status: ['done'], tags: ['alpha'] })).map((item) => item.id)).not.toContain(created.id)
    await service.appendMessage('member', createdThread.id, { content: '첫 의견', kind: 'discussion' })
    await service.appendMessage('member', createdThread.id, { content: '둘째 의견', kind: 'discussion' })
    expect((await service.messages(createdThread.id)).map((item) => [item.seq, item.content, item.kind])).toEqual([[1, '첫 의견', 'discussion'], [2, '둘째 의견', 'discussion']])
    expect((await service.activity(created.id)).some((item) => item.type === 'message.sent')).toBe(true)
    await service.delete(created.id)
    await expect(extras.notes('member', created.id)).rejects.toMatchObject({ status: 404 })
    expect((await db.select().from(task).where(eq(task.id, created.id)))[0]?.deletedAt).toBeTruthy()
    expect(await db.select().from(thread).where(eq(thread.id, createdThread.id))).toHaveLength(1)
    expect(await db.select().from(message).where(eq(message.threadId, createdThread.id))).toHaveLength(2)
    expect((await service.list()).map((item) => item.id)).not.toContain(created.id)
    expect((await stats.stats()).find((item) => item.assistantId === assistantId)!.inProgress).toBe(before)
    await expect(service.messages(createdThread.id)).rejects.toMatchObject({ status: 404 })
  })

  it('retains its own file but protects a file selected by another task', async () => {
    const { task: source } = await service.create('member', { assistantId })
    const { task: consumer } = await service.create('member', { assistantId })
    await db.insert(fileObject).values({ id: 'owned-file', kind: 'task_file', originTaskId: source.id, originalName: 'x.txt', mime: 'text/plain', sizeBytes: 1, sha256: 'a'.repeat(64), storageKey: `test/${source.id}`, source: 'upload', version: 1, uploadedBy: 'member' })
    await db.insert(taskInput).values({ taskId: consumer.id, fileId: 'owned-file', weight: 'main', sortOrder: 0, selectedBy: 'member' })
    await expect(service.delete(source.id)).rejects.toMatchObject({ status: 409 })
    await db.delete(taskInput).where(eq(taskInput.taskId, consumer.id))
    await service.delete(source.id)
    expect(await db.select().from(fileObject).where(eq(fileObject.id, 'owned-file'))).toHaveLength(1)
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

  it('assigns distinct ordered sequence numbers to concurrent discussion messages', async () => {
    const { thread: createdThread } = await service.create('member', { assistantId })
    await Promise.all(Array.from({ length: 6 }, (_, index) => service.appendMessage('member', createdThread.id, { content: `parallel-${index}`, kind: 'discussion' })))
    expect((await service.messages(createdThread.id)).map((item) => item.seq)).toEqual([1, 2, 3, 4, 5, 6])
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
    await db.insert(appUser).values({ id: 'assignee', name: 'Assignee', initials: 'A', color: '#123456' }).onDuplicateKeyUpdate({ set: { id: 'assignee' } })
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
