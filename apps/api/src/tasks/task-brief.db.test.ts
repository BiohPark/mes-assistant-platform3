import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/mysql2'
import { eq } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'
import type { ChatProvider, ChatRequest } from '@mes/llm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../config/config.js'
import { createPool } from '../db/connection.js'
import type { Db } from '../db/db.module.js'
import { runMigrations } from '../db/migrate.js'
import { appSetting, appUser, assistant, message, task, taskBrief } from '../db/schema.js'
import { seedCatalog } from '../db/seed.js'
import { EventsService } from '../events/events.service.js'
import { FileStorageService } from '../files/fileStorage.service.js'
import { DbConversationInputsService } from '../context/conversation-inputs.service.js'
import { RequestsService } from '../requests/requests.service.js'
import { createTempDb } from '../test/tempDb.js'
import { TaskBriefService } from './task-brief.service.js'
import { TaskExtrasService } from './task-extras.service.js'
import { DbTasksService } from './tasks.service.js'

describe('대화 요약 카드 (표시 전용·백그라운드 생성)', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  let db: Db
  let root: string
  let config: ReturnType<typeof loadConfig>
  let tasks: DbTasksService
  let assistantId: string
  const seen: ChatRequest[] = []
  const kinds: string[] = []
  let answer: () => string
  const provider: ChatProvider = {
    kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
    async *stream(request) {
      seen.push(request)
      const text = answer()
      if (text === 'ERROR') yield { type: 'error', message: '모델 오류' }
      else yield { type: 'delta', text }
      yield { type: 'done' }
    },
  }
  const events = new EventsService()
  const service = (chat = provider) => {
    const requests = new RequestsService(db, config, chat)
    const runAuxiliary = requests.runAuxiliary.bind(requests)
    requests.runAuxiliary = ((actor, kind, operation, options) => { kinds.push(kind); return runAuxiliary(actor, kind, operation, options) }) as typeof requests.runAuxiliary
    return new TaskBriefService(db, config, chat, requests, events)
  }
  let nextSeq = 1
  async function say(threadId: string, role: 'user' | 'assistant', content: string, extra: Partial<typeof message.$inferInsert> = {}) {
    await db.insert(message).values({ id: crypto.randomUUID(), threadId, seq: nextSeq++, role, content, status: 'done', ...(role === 'user' && { authorId: 'member' }), ...extra })
  }
  const conversation = async (extra: Parameters<DbTasksService['create']>[1] = { assistantId }) => (await tasks.create('member', extra))

  beforeAll(async () => {
    temp = await createTempDb('task_brief')
    await runMigrations(temp.url)
    client = createPool(temp.url)
    db = drizzle(client)
    await seedCatalog(db)
    await db.insert(appUser).values([{ id: 'member', name: '멤버', initials: 'M', color: '#123456' },
      { id: 'other', name: '동료', initials: 'D', color: '#654321' },
      { id: 'outsider', name: '외부 담당', initials: 'O', color: '#111111', isBusinessOwner: true }])
    assistantId = (await db.select().from(assistant))[0]!.id
    root = await mkdtemp(join(tmpdir(), 'mes-brief-'))
    config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', LLM_DEFAULT_MODEL: 'default-model', FILE_STORAGE_ROOT: root })
    const extras = new TaskExtrasService(db, { kind: 'mock' } as never, { runAuxiliary: async () => undefined } as never, new FileStorageService(root), { publish: () => undefined } as never)
    tasks = new DbTasksService(db, undefined, extras)
  })
  afterAll(async () => { await client?.end(); await temp?.drop(); if (root) await rm(root, { recursive: true, force: true }) })
  beforeEach(() => { seen.length = 0; kinds.length = 0; answer = () => '주제: 알람 원인 분석\n다음: 센서 교체 이력을 확인해 보세요' })

  it('AI 답이 없으면 만들지 않고, 2줄(질문 수·참여자·시작 시각)은 서버가 계산한다', async () => {
    const { task: owner, thread } = await conversation()
    await say(thread.id, 'user', '알람 원인을 찾아 줘')
    await say(thread.id, 'user', '센서 쪽 같아요', { kind: 'discussion', authorId: 'other' })
    const run = service()
    const brief = await run.get('member', owner.id)
    await run.settled()
    expect(seen).toHaveLength(0)
    expect(brief).toEqual({ stats: { questions: 1, participants: [{ id: 'member', name: '멤버' }, { id: 'other', name: '동료' }], startedAt: owner.createdAt },
      generating: false, failed: false, stale: false })
  })

  it('진입 때 새 메시지가 있고 AI 답이 있으면 대화 모델로 한 번 만들어 저장하고 brief.updated를 알린다', async () => {
    const { task: owner, thread } = await conversation()
    await db.update(task).set({ modelId: 'chat-model' }).where(eq(task.id, owner.id))
    await say(thread.id, 'user', '알람 원인을 찾아 줘')
    await say(thread.id, 'assistant', '온도 센서로 보입니다')
    const published = vi.spyOn(events, 'publish')
    const run = service()
    const [first, again] = [await run.get('member', owner.id), await run.get('member', owner.id)]
    expect(first).toMatchObject({ generating: true, failed: false, stale: false })
    expect(first).not.toHaveProperty('ai')
    expect(again.generating).toBe(true)
    await run.settled()
    expect(seen).toHaveLength(1) // 진행 중에 다시 들어와도 한 번만
    expect(seen[0]!.model).toBe('chat-model')
    expect(kinds).toEqual(['brief'])
    expect(published).toHaveBeenCalledWith('brief.updated', { taskId: owner.id })
    const ready = await run.get('member', owner.id)
    expect(ready).toMatchObject({ generating: false, stale: false, failed: false,
      ai: { about: '알람 원인 분석', next: '센서 교체 이력을 확인해 보세요', source: 'ai', model: 'chat-model', basedOnSeq: nextSeq - 1 } })
    await run.settled()
    expect(seen).toHaveLength(1) // 최신이면 다시 부르지 않는다

    await say(thread.id, 'user', '교체 이력은?')
    answer = () => '주제: 센서 교체 이력\n다음: 정비 기록을 첨부해 보세요'
    const stale = await run.get('member', owner.id)
    expect(stale).toMatchObject({ stale: true, generating: true, ai: { about: '알람 원인 분석' } }) // 새로 만드는 동안 옛 결과를 보인다
    await run.settled()
    expect((await run.get('member', owner.id)).ai).toMatchObject({ about: '센서 교체 이력', basedOnSeq: nextSeq - 1 })
    published.mockRestore()
  })

  it('실패하면 저장하지 않고 같은 메시지 기준으로는 잠시 다시 부르지 않는다 — 새 메시지가 오면 다시 시도', async () => {
    const { task: owner, thread } = await conversation()
    await say(thread.id, 'user', '질문')
    await say(thread.id, 'assistant', '답')
    answer = () => 'ERROR'
    const run = service()
    await run.get('member', owner.id)
    await run.settled()
    const failed = await run.get('member', owner.id)
    await run.settled()
    expect(seen).toHaveLength(1)
    expect(failed).toMatchObject({ generating: false, failed: true })
    expect(failed).not.toHaveProperty('ai')
    expect(await db.select().from(taskBrief).where(eq(taskBrief.taskId, owner.id))).toHaveLength(0)
    answer = () => '주제: 다시\n다음: 이어서'
    await say(thread.id, 'user', '다시 질문')
    await run.get('member', owner.id)
    await run.settled()
    expect((await run.get('member', owner.id))).toMatchObject({ failed: false, ai: { about: '다시' } })
  })

  it('요청 크기 한도를 넘으면 자르지 않고 실패로 둔다', async () => {
    const { task: owner, thread } = await conversation()
    await db.insert(appSetting).values({ key: 'requestBudgetBytes', value: 1024 }).onDuplicateKeyUpdate({ set: { value: 1024 } })
    try {
      await say(thread.id, 'user', '가'.repeat(2000))
      await say(thread.id, 'assistant', '답')
      const run = service()
      await run.get('member', owner.id)
      await run.settled()
      expect(seen).toHaveLength(0)
      expect(await run.get('member', owner.id)).toMatchObject({ failed: true })
    } finally { await db.delete(appSetting).where(eq(appSetting.key, 'requestBudgetBytes')) }
  })

  it('mock 모드는 모델을 부르지 않고 결정적인 규칙 카드를 저장한다', async () => {
    const { task: owner, thread } = await conversation()
    await say(thread.id, 'user', '보고서 초안을 써 줘\n양식은 첨부')
    await say(thread.id, 'assistant', '초안입니다')
    const stream = vi.fn()
    const run = service({ ...provider, kind: 'mock', stream } as unknown as ChatProvider)
    await run.get('member', owner.id)
    await run.settled()
    expect(stream).not.toHaveBeenCalled()
    expect((await run.get('member', owner.id)).ai).toMatchObject({ about: '(Mock 대역) 보고서 초안을 써 줘', source: 'rule' })
  })

  it('권한은 대화 읽기 권한과 같다 — 관련 없는 담당자는 403, 삭제된 대화는 404', async () => {
    const { task: owner } = await conversation()
    const run = service()
    await expect(run.get('outsider', owner.id)).rejects.toMatchObject({ status: 403 })
    await tasks.delete(owner.id, 'member')
    await expect(run.get('member', owner.id)).rejects.toMatchObject({ status: 404 })
  })

  it('표시 전용 — 요약 카드는 요청 조립·트레이 후보·참조 대화에 들어가지 않는다', async () => {
    const marker = 'BRIEF-MARKER-표시전용'
    const source = await conversation({ assistantId, tags: ['brief-display'] })
    const target = await conversation({ assistantId, tags: ['brief-display'] })
    await say(source.thread.id, 'user', '원본 질문')
    await say(source.thread.id, 'assistant', '원본 답')
    await db.insert(taskBrief).values({ taskId: source.task.id, about: marker, nextAction: marker, source: 'ai', basedOnSeq: nextSeq - 1 })
    const inputs = new DbConversationInputsService(db)
    await inputs.select('member', target.task.id, source.task.id, { mode: 'full' })
    expect(JSON.stringify(await inputs.load(target.task.id))).toContain('원본 답')
    expect(JSON.stringify(await inputs.load(target.task.id))).not.toContain(marker)
    expect(JSON.stringify(await inputs.candidates(target.task.id))).not.toContain(marker)
    expect(JSON.stringify(await tasks.get(source.task.id))).not.toContain(marker)
    const captured: ChatRequest[] = []
    const capture: ChatProvider = { kind: 'mock', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
      async *stream(request) { captured.push(request); yield { type: 'delta', text: '응답' }; yield { type: 'done' } } }
    const requests = new RequestsService(db, config, capture)
    try {
      for (const [owner, key] of [[source, 'brief-a'], [target, 'brief-b']] as const) {
        expect(JSON.stringify(await requests.estimate('member', owner.thread.id, { draft: '다음 질문' }))).not.toContain(marker)
        await (await requests.start('member', owner.thread.id, { content: '다음 질문' }, key)).done
      }
      expect(captured.length).toBeGreaterThanOrEqual(2)
      expect(JSON.stringify(captured.map((request) => request.messages))).toContain('원본 답')
      expect(JSON.stringify(captured.map((request) => request.messages))).not.toContain(marker)
    } finally { requests.onModuleDestroy() }
  })
})
