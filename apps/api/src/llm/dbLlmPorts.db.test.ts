import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config/config.js'
import { runMigrations } from '../db/migrate.js'
import { appSetting, appUser, assistant, fileObject, task } from '../db/schema.js'
import { createTempDb } from '../test/tempDb.js'
import { DbLlmPorts } from './dbLlmPorts.js'

describe('DbLlmPorts', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: postgres.Sql
  let db: ReturnType<typeof drizzle>
  const config = loadConfig({ DATABASE_URL: 'postgres://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' })
  beforeAll(async () => { temp = await createTempDb('llm_ports'); await runMigrations(temp.url); client = postgres(temp.url); db = drizzle(client) })
  afterAll(async () => { await client?.end(); await temp?.drop() })

  it('빈 DB는 설정 기본값과 빈 카탈로그를 반환한다', async () => {
    const ports = new DbLlmPorts(db, config, 'u1')
    expect(await ports.getSettings()).toMatchObject({ id: 'app', currentUserId: 'u1', llm: { mode: 'mock', model: 'glm-5.2' } })
    expect(await ports.getAssistants()).toEqual([])
    expect(await ports.getTask('missing')).toBeUndefined()
    await expect(ports.readFileBytes()).rejects.toThrow(/NotImplemented/)
  })

  it('설정 병합과 삽입한 사용자·어시스턴트 조회', async () => {
    await db.insert(appSetting).values({ key: 'srIntakeAssistantId', value: 'a1' })
    await db.insert(appUser).values({ id: 'u1', name: '운영', role: '', initials: '운', color: 'blue' })
    await db.insert(assistant).values({ id: 'a1', name: '도우미', level1: '업무', level2: '일반', sortOrder: 1, ownerId: 'u1', status: 'open', color: 'blue', createdBy: 'u1' })
    const ports = new DbLlmPorts(db, config, 'u1')
    expect((await ports.getSettings()).srIntakeAssistantId).toBe('a1')
    expect((await ports.getUsers())[0]?.id).toBe('u1')
    expect((await ports.getAssistants())[0]).toMatchObject({ id: 'a1', expectedInputs: [], checklistTemplate: [] })
  })

  it('업무와 파일을 입력 순서대로 조회하고 없는 ID는 undefined로 둔다', async () => {
    await db.insert(task).values({ id: 't1', code: 'WK-2026-0001', assistantId: 'a1', title: '작업', titleSource: 'manual', status: 'todo', ownerId: 'u1', priority: 'normal', createdBy: 'u1' })
    await db.insert(fileObject).values({ id: 'f1', kind: 'task_file', originTaskId: 't1', originalName: 'result.txt', mime: 'text/plain', sizeBytes: 5, sha256: 'a'.repeat(64), storageKey: '2026/09/f1.txt', source: 'assistant', isOutput: true, version: 1, uploadedBy: 'u1' })
    const ports = new DbLlmPorts(db, config, 'u1')
    expect((await ports.getTasks(['missing', 't1']))[1]).toMatchObject({ id: 't1', outputFileIds: ['f1'] })
    expect((await ports.getFiles(['missing', 'f1']))[1]).toMatchObject({ id: 'f1', name: 'result.txt', size: 5, source: 'assistant' })
  })
})
