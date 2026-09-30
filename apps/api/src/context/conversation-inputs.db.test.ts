import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/mysql2'
import { eq } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'
import type { Db } from '../db/db.module.js'
import { createPool } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { appUser, assistant, chatRequest, chatRequestInput, contextSnapshot, contextSnapshotMessage, conversationInput, message } from '../db/schema.js'
import { createTempDb } from '../test/tempDb.js'
import { DbTasksService } from '../tasks/tasks.service.js'
import { loadConfig } from '../config/config.js'
import { RequestsService } from '../requests/requests.service.js'
import { MockProvider } from '@mes/llm'
import { conversationCandidates } from '@mes/domain'
import { DbConversationInputsService } from './conversation-inputs.service.js'

describe('conversation inputs DB', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  let db: Db
  let tasks: DbTasksService
  let service: DbConversationInputsService
  let assistantId: string
  const actor = 'context-member'
  beforeAll(async () => {
    temp = await createTempDb('context')
    await runMigrations(temp.url)
    client = createPool(temp.url)
    db = drizzle(client)
    await seedCatalog(db)
    await db.insert(appUser).values({ id: actor, name: 'Member', initials: 'M', color: '#123456' })
    assistantId = (await db.select().from(assistant))[0]!.id
    tasks = new DbTasksService(db)
    service = new DbConversationInputsService(db)
  })
  afterAll(async () => { await client?.end(); await temp?.drop() })

  async function make(tags: string[], turns: string[] = []) {
    const created = await tasks.create(actor, { assistantId, tags })
    for (const [index, content] of turns.entries()) await db.insert(message).values({ id: `${created.task.id}-${index}`, threadId: created.thread.id,
      seq: index + 1, role: index % 2 ? 'assistant' : 'user', content, status: 'done', authorId: index % 2 ? null : actor })
    return created
  }

  it('offers only directly shared, eligible conversations and excludes deleted sources', async () => {
    const mine = await make(['context-direct'])
    const source = await make(['context-direct', 'context-indirect'], ['한글', 'answer'])
    const indirect = await make(['context-indirect'], ['hidden'])
    await db.insert(message).values({ id: `${source.task.id}-team`, threadId: source.thread.id, seq: 3, role: 'user', kind: 'discussion', content: 'team', status: 'done', authorId: actor })
    await db.insert(message).values({ id: `${source.task.id}-empty`, threadId: source.thread.id, seq: 4, role: 'assistant', content: '  ', status: 'done' })
    const candidates = await service.candidates(mine.task.id)
    expect(candidates.map((item) => item.taskId)).toEqual(conversationCandidates(mine.task, [source.task, indirect.task], []).map((item) => item.task.id))
    expect(candidates.map((item) => item.taskId)).toContain(source.task.id)
    expect(candidates.map((item) => item.taskId)).not.toContain(indirect.task.id)
    expect(candidates.find((item) => item.taskId === source.task.id)).toMatchObject({ messageCount: 2, bytes: Buffer.byteLength('한글') + Buffer.byteLength('answer') })
    await tasks.delete(source.task.id)
    expect((await service.candidates(mine.task.id)).map((item) => item.taskId)).not.toContain(source.task.id)
  })

  it('rejects a source without a directly shared tag and the task itself', async () => {
    const source = await make(['context-other'], ['q', 'a'])
    const mine = await make(['context-mine'])
    await expect(service.select(actor, mine.task.id, source.task.id, { mode: 'full' }))
      .rejects.toMatchObject({ status: 409, response: { code: 'TAG_NOT_SHARED' } })
    await expect(service.select(actor, mine.task.id, mine.task.id, { mode: 'full' }))
      .rejects.toMatchObject({ status: 400, response: { code: 'SELF_REFERENCE' } })
  })

  it('re-selects a pair with a replacement snapshot and only one input row', async () => {
    const source = await make(['context-reselect'], ['q', 'a'])
    const mine = await make(['context-reselect'])
    const first = await service.select(actor, mine.task.id, source.task.id, { mode: 'full' })
    const second = await service.select(actor, mine.task.id, source.task.id, { mode: 'full', weight: 'main' })
    expect(second.input.id).toBe(first.input.id)
    expect(second.snapshot.id).not.toBe(first.snapshot.id)
    expect(second.input.weight).toBe('main')
    expect(await db.select().from(conversationInput).where(eq(conversationInput.taskId, mine.task.id))).toHaveLength(1)
  })

  it('pins immutable full and chosen-message snapshots, validates IDs, and refreshes only full', async () => {
    const source = await make(['context-pin'], ['q1', 'a1'])
    const mine = await make(['context-pin'])
    const first = await service.select(actor, mine.task.id, source.task.id, { mode: 'full' })
    expect(first.snapshot.messageIds).toEqual([`${source.task.id}-0`, `${source.task.id}-1`])
    await expect(service.select(actor, mine.task.id, source.task.id, { mode: 'messages', messageIds: ['bogus'] })).rejects.toMatchObject({ status: 400 })
    const foreign = await make(['context-pin'], ['다른 스레드'])
    await expect(service.select(actor, mine.task.id, source.task.id, { mode: 'messages', messageIds: [`${foreign.task.id}-0`] })).rejects.toMatchObject({ status: 400 })
    await expect(service.select(actor, mine.task.id, source.task.id, { mode: 'messages', messageIds: [`${source.task.id}-0`, `${source.task.id}-0`] })).rejects.toMatchObject({ status: 400 })
    await db.insert(message).values({ id: `${source.task.id}-2`, threadId: source.thread.id, seq: 3, role: 'user', content: 'q2', status: 'done', authorId: actor })
    expect((await service.list(mine.task.id))[0]).toMatchObject({ newMessages: 1, messageCount: 2 })
    const refreshed = await service.refresh(actor, mine.task.id, source.task.id)
    expect(refreshed.snapshot.messageIds).toHaveLength(3)
    expect((await db.select().from(contextSnapshot).where(eq(contextSnapshot.id, first.snapshot.id)))).toHaveLength(1)
    const chosen = await service.select(actor, mine.task.id, source.task.id, { mode: 'messages', messageIds: [`${source.task.id}-2`, `${source.task.id}-0`] })
    expect(chosen.snapshot.messageIds).toEqual([`${source.task.id}-0`, `${source.task.id}-2`])
    await expect(service.refresh(actor, mine.task.id, source.task.id)).rejects.toMatchObject({ status: 400 })
    await tasks.setStatus(actor, mine.task.id, 'done')
    await expect(service.remove(actor, mine.task.id, source.task.id)).rejects.toMatchObject({ status: 409, response: { code: 'TASK_DONE' } })
  })

  it('rejects selection, weight change, removal, and refresh on a completed task', async () => {
    const source = await make(['context-completed'], ['q', 'a'])
    const mine = await make(['context-completed'])
    await service.select(actor, mine.task.id, source.task.id, { mode: 'full' })
    await tasks.setStatus(actor, mine.task.id, 'done')
    const done = { status: 409, response: { code: 'TASK_DONE' } }
    await expect(service.select(actor, mine.task.id, source.task.id, { mode: 'full' })).rejects.toMatchObject(done)
    await expect(service.setWeight(actor, mine.task.id, source.task.id, 'main')).rejects.toMatchObject(done)
    await expect(service.remove(actor, mine.task.id, source.task.id)).rejects.toMatchObject(done)
    await expect(service.refresh(actor, mine.task.id, source.task.id)).rejects.toMatchObject(done)
  })

  it('counts same-time turns after the stored boundary in sequence order', async () => {
    const source = await make(['context-same-time'], ['first question', 'first answer'])
    const mine = await make(['context-same-time'])
    const sameTime = new Date('2026-01-01T00:00:00.000Z')
    await db.update(message).set({ createdAt: sameTime }).where(eq(message.threadId, source.thread.id))
    const selected = await service.select(actor, mine.task.id, source.task.id, { mode: 'full' })
    expect(selected.snapshot.messageIds).toEqual([`${source.task.id}-0`, `${source.task.id}-1`])
    await db.insert(message).values([
      { id: `${source.task.id}-!later-q`, threadId: source.thread.id, seq: 3, role: 'user', content: 'later question', status: 'done', authorId: actor, createdAt: sameTime },
      { id: `${source.task.id}-!later-a`, threadId: source.thread.id, seq: 4, role: 'assistant', content: 'later answer', status: 'done', createdAt: sameTime },
    ])
    expect((await service.load(mine.task.id))[0]).toMatchObject({ newMessages: 2, messages: [
      { id: `${source.task.id}-0` }, { id: `${source.task.id}-1` },
    ] })
  })

  it('retains detached selections and protects a referenced source from deletion', async () => {
    const source = await make(['context-detach'], ['q', 'a'])
    const mine = await make(['context-detach'])
    await service.select(actor, mine.task.id, source.task.id, { mode: 'full' })
    await tasks.removeTag(actor, mine.task.id, 'context-detach')
    expect((await service.list(mine.task.id))[0]?.detached).toBe(true)
    const refreshed = await service.refresh(actor, mine.task.id, source.task.id)
    expect(refreshed.detached).toBe(true)
    await service.setWeight(actor, mine.task.id, source.task.id, 'main')
    expect((await service.list(mine.task.id))[0]?.input.weight).toBe('main')
    await service.setWeight(actor, mine.task.id, source.task.id, 'reference')
    expect((await service.list(mine.task.id))[0]?.input.weight).toBe('reference')
    await expect(tasks.delete(source.task.id)).rejects.toMatchObject({ status: 409, response: { code: 'REFERENCED' } })
    await service.remove(actor, mine.task.id, source.task.id)
    expect(await db.select().from(conversationInput).where(eq(conversationInput.taskId, mine.task.id))).toHaveLength(0)
    await tasks.delete(source.task.id)
  })

  it('cleans the deleted task own inputs and then permits deletion of its source', async () => {
    const source = await make(['context-delete-own'], ['q', 'a'])
    const mine = await make(['context-delete-own'])
    await service.select(actor, mine.task.id, source.task.id, { mode: 'full' })
    await expect(tasks.delete(source.task.id)).rejects.toMatchObject({ status: 409, response: { code: 'REFERENCED' } })
    await tasks.delete(mine.task.id)
    expect(await db.select().from(conversationInput).where(eq(conversationInput.taskId, mine.task.id))).toHaveLength(0)
    await tasks.delete(source.task.id)
  })

  it('creates a main full reference in the new task transaction and returns warnings when tags differ', async () => {
    const source = await make(['context-create'], ['reference question', 'reference answer'])
    const selected = await tasks.create(actor, { assistantId, tags: ['context-create'], referenceTaskId: source.task.id })
    expect((await service.list(selected.task.id))[0]).toMatchObject({ input: { weight: 'main', mode: 'full' }, messageCount: 2 })
    expect(selected.warnings).toEqual([])
    const ignored = await tasks.create(actor, { assistantId, tags: ['different-tag'], referenceTaskId: source.task.id })
    expect(ignored.warnings).toHaveLength(1)
    expect(await service.list(ignored.task.id)).toEqual([])
  })

  it('uses the reviewed summary through the request builder and records the snapshot', async () => {
    const source = await make(['context-prompt'], ['source question', 'source answer'])
    const mine = await make(['context-prompt'])
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' }), new MockProvider())
    try {
      const countBeforeDraft = (await db.select({ id: chatRequest.id }).from(chatRequest)).length
      const summary = await runner.draftConversationSummary(actor, mine.task.id, await service.preview(source.task.id))
      expect(summary).toMatchObject({ source: 'rule', text: expect.stringContaining('source answer') })
      expect(await db.select({ id: chatRequest.id }).from(chatRequest)).toHaveLength(countBeforeDraft)
      const chosen = await service.select(actor, mine.task.id, source.task.id, { mode: 'summary', weight: 'main',
        summary: { text: '사람이 수정한 요약', source: summary.source, messageIds: [`${source.task.id}-1`, `${source.task.id}-0`] } })
      expect(chosen.snapshot.messageIds).toEqual([`${source.task.id}-0`, `${source.task.id}-1`])
      expect(await db.select().from(contextSnapshotMessage).where(eq(contextSnapshotMessage.snapshotId, chosen.snapshot.id)).orderBy(contextSnapshotMessage.seq))
        .toMatchObject([{ seq: 0, messageId: `${source.task.id}-0` }, { seq: 1, messageId: `${source.task.id}-1` }])
      expect((await service.load(mine.task.id))[0]?.messages).toEqual([])
      const started = await runner.start(actor, mine.thread.id, { content: '참조 내용 알려줘' }, id())
      await started.done
      const inputs = await db.select().from(chatRequestInput).where(eq(chatRequestInput.requestId, started.id))
      expect(inputs).toMatchObject([expect.objectContaining({ kind: 'conversation', sourceTaskId: source.task.id, snapshotId: chosen.snapshot.id, mode: 'summary' })])
      expect(JSON.stringify(await runner.snapshot(started.id))).toContain('사람이 수정한 요약')
      expect(JSON.stringify(await runner.snapshot(started.id))).not.toContain('source question')
      await service.remove(actor, mine.task.id, source.task.id)
      await expect(tasks.delete(source.task.id)).rejects.toMatchObject({ status: 409 })
    } finally { runner.onModuleDestroy() }
  })

  it('places only pinned source messages in the reference section of the request', async () => {
    const source = await make(['context-full-prompt'], ['선택 질문', '선택 답변'])
    await db.insert(message).values({ id: `${source.task.id}-note`, threadId: source.thread.id, seq: 3, role: 'user', kind: 'discussion', content: '팀 의견 제외', status: 'done', authorId: actor })
    const mine = await make(['context-full-prompt'])
    await service.select(actor, mine.task.id, source.task.id, { mode: 'full' })
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' }), new MockProvider())
    try {
      const started = await runner.start(actor, mine.thread.id, { content: '참조해 줘' }, id())
      await started.done
      const snapshot = JSON.stringify(await runner.snapshot(started.id))
      expect(snapshot).toContain('## 참조 대화 (1)')
      expect(snapshot).toContain('선택 질문')
      expect(snapshot).toContain('선택 답변')
      expect(snapshot).not.toContain('팀 의견 제외')
    } finally { runner.onModuleDestroy() }
  })
})

const id = () => crypto.randomUUID()
