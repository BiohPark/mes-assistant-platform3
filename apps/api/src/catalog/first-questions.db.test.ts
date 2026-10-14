import { drizzle } from 'drizzle-orm/mysql2'
import { eq } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'
import type { ChatProvider, ChatRequest } from '@mes/llm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config/config.js'
import { createPool } from '../db/connection.js'
import type { Db } from '../db/db.module.js'
import { runMigrations } from '../db/migrate.js'
import { assistant } from '../db/schema.js'
import { seedCatalog } from '../db/seed.js'
import { RequestsService } from '../requests/requests.service.js'
import { createTempDb } from '../test/tempDb.js'
import { DbCatalogReader } from './catalog.service.js'
import { FirstQuestionsService } from './first-questions.js'

describe('AI 추천 첫 질문 (에이전트별 1회 생성·저장)', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  let db: Db
  let config: ReturnType<typeof loadConfig>
  let ids: string[]
  const seen: ChatRequest[] = []
  let answer: () => string = () => '첫째 질문\n둘째 질문\n셋째 질문'
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
  const kinds: string[] = []
  const service = (chat = provider) => {
    const requests = new RequestsService(db, config, chat)
    const runAuxiliary = requests.runAuxiliary.bind(requests)
    requests.runAuxiliary = ((actor, kind, operation, options) => { kinds.push(kind); return runAuxiliary(actor, kind, operation, options) }) as typeof requests.runAuxiliary
    return new FirstQuestionsService(db, config, chat, requests)
  }
  const view = async (id: string) => (await new DbCatalogReader(db).assistants()).find((item) => item.id === id)!

  beforeAll(async () => {
    temp = await createTempDb('first_questions')
    await runMigrations(temp.url)
    client = createPool(temp.url)
    db = drizzle(client)
    await seedCatalog(db)
    config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', LLM_DEFAULT_MODEL: 'default-model' })
    ids = (await db.select({ id: assistant.id }).from(assistant)).map((row) => row.id)
  })
  afterAll(async () => { await client?.end(); await temp?.drop() })
  beforeEach(() => { seen.length = 0; answer = () => '첫째 질문\n둘째 질문\n셋째 질문' })

  it('없으면 그 에이전트 모델로 한 번 만들어 저장하고, 카탈로그가 내려준다 — revision·updatedAt은 그대로', async () => {
    const id = ids[0]!
    await db.update(assistant).set({ modelId: 'agent-model' }).where(eq(assistant.id, id))
    const before = await view(id)
    expect(before).not.toHaveProperty('suggestedQuestions')
    const first = service()
    first.schedule([before, before])
    await first.settled()
    expect(seen).toHaveLength(1)
    expect(seen[0]!.model).toBe('agent-model')
    expect(kinds).toEqual(['suggest']) // 제목 슬롯을 빌리지 않는 전용 보조 종류
    expect(seen[0]!.messages[1]!.content).toBe(`이름: ${before.name}\n설명: ${before.summary}`)
    const after = await view(id)
    expect(after.suggestedQuestions).toEqual(['첫째 질문', '둘째 질문', '셋째 질문'])
    expect({ revision: after.revision, updatedAt: after.updatedAt }).toEqual({ revision: before.revision, updatedAt: before.updatedAt })
    first.schedule([after])
    await first.settled()
    expect(seen).toHaveLength(1) // 저장된 것이 최신이면 다시 부르지 않는다
  })

  it('modelId·이름·설명이 바뀌면 낡은 질문은 내려가지 않고 다시 만든다(모델이 없으면 기본 모델)', async () => {
    const id = ids[1]!
    const run = service()
    run.schedule([await view(id)])
    await run.settled()
    expect(seen.at(-1)!.model).toBe('default-model')
    for (const change of [{ name: '바뀐 이름' }, { summary: '바뀐 설명' }, { modelId: 'other-model' }]) {
      await db.update(assistant).set(change).where(eq(assistant.id, id))
      const stale = await view(id)
      expect(stale).not.toHaveProperty('suggestedQuestions')
      answer = () => `${Object.values(change)[0]} 질문`
      run.schedule([stale])
      await run.settled()
      expect((await view(id)).suggestedQuestions).toEqual([`${Object.values(change)[0]} 질문`])
    }
    expect(seen.at(-1)!.model).toBe('other-model')
  })

  it('실패하면 저장하지 않고 같은 내용으로는 잠시 다시 부르지 않는다 — 내용이 바뀌면 바로 다시 시도', async () => {
    const id = ids[2]!
    answer = () => 'ERROR'
    const run = service()
    run.schedule([await view(id)])
    await run.settled()
    expect(seen).toHaveLength(1)
    expect(await view(id)).not.toHaveProperty('suggestedQuestions')
    run.schedule([await view(id)])
    await run.settled()
    expect(seen).toHaveLength(1)
    answer = () => '다시 만든 질문'
    await db.update(assistant).set({ summary: '고친 설명' }).where(eq(assistant.id, id))
    run.schedule([await view(id)])
    await run.settled()
    expect((await view(id)).suggestedQuestions).toEqual(['다시 만든 질문'])
  })

  it('mock 모드와 중단된 에이전트는 부르지 않는다', async () => {
    const id = ids[3]!
    const mock: ChatProvider = { ...provider, kind: 'mock' }
    const quiet = service(mock)
    quiet.schedule([await view(id)])
    await quiet.settled()
    await db.update(assistant).set({ status: 'retired' }).where(eq(assistant.id, id))
    const run = service()
    run.schedule([await view(id)])
    await run.settled()
    expect(seen).toHaveLength(0)
    expect(await view(id)).not.toHaveProperty('suggestedQuestions')
  })
})
