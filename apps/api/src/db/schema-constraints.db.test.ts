import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import type { Db } from './db.module.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPool } from './connection.js'
import { runMigrations } from './migrate.js'
import { seedCatalog } from './seed.js'
import { activityLog, appSetting, appUser, assistant, chatRequest, chatRequestInput, code, codeGroup, fileObject, fileRemoteRef, message, task, thread } from './schema.js'
import { createTempDb } from '../test/tempDb.js'

// PostgreSQL 초안 SQL과의 문법 비교 대신 MariaDB에서 제약의 실제 동작을 확인한다.
describe('MariaDB 제약 동작', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let pool: ReturnType<typeof createPool>
  let db: Db
  beforeAll(async () => {
    temp = await createTempDb('constraints')
    await runMigrations(temp.url)
    pool = createPool(temp.url)
    db = drizzle(pool)
    await seedCatalog(db)
  })
  afterAll(async () => { await pool?.end(); await temp?.drop() })

  it('check·FK 위반을 거부한다', async () => {
    await expect(db.insert(assistant).values({ id: 'invalid-status', name: 'bad', level1CodeId: 'assistant_level1:Record', level2CodeId: 'assistant_level2:Deviation', sortOrder: 1, ownerId: 'seed-system', createdBy: 'seed-system', status: 'unknown', color: '#000' })).rejects.toMatchObject({ cause: { errno: 4025 } })
    await expect(db.insert(code).values({ id: 'missing-parent', groupKey: 'missing', code: 'x', name: 'x' })).rejects.toMatchObject({ cause: { errno: 1452 } })
  })

  it('대소문자 구분과 길이 제한을 지킨다', async () => {
    await db.insert(codeGroup).values({ key: 'case', name: 'case' })
    await db.insert(code).values([{ id: 'case-upper', groupKey: 'case', code: 'ABC', name: 'A' }, { id: 'case-lower', groupKey: 'case', code: 'abc', name: 'a' }])
    await db.insert(code).values([{ id: 'space-plain', groupKey: 'case', code: 'trail', name: 'A' }, { id: 'space-suffix', groupKey: 'case', code: 'trail ', name: 'B' }])
    const [comparison] = await pool.query("select 'trail' = 'trail ' collate utf8mb4_nopad_bin as equal_value")
    expect((comparison as { equal_value: number }[])[0]?.equal_value).toBe(0)
    await expect(db.insert(codeGroup).values({ key: 'x'.repeat(192), name: 'long' })).rejects.toMatchObject({ cause: { errno: 1406 } })
  })

  it('JSON은 객체로 읽힌다', async () => {
    await db.insert(appSetting).values({ key: 'json-contract', value: { enabled: true, count: 2 } })
    const rows = await db.select().from(appSetting)
    expect(rows.find((row) => row.key === 'json-contract')?.value).toEqual({ enabled: true, count: 2 })
  })

  it('삭제되지 않은 파일 버전과 진행 중 요청은 각각 하나만 허용한다', async () => {
    await db.insert(appUser).values({ id: 'constraint-user', name: 'Tester', initials: 'T', color: '#000' })
    await db.insert(task).values({ id: 'constraint-task', code: 'TEST-1', assistantId: 'deviation-drafter', title: 'test', titleSource: 'manual', status: 'todo', ownerId: 'constraint-user', priority: 'normal', createdBy: 'constraint-user' })
    const file = (id: string, deletedAt?: Date) => ({ id, kind: 'task_file', originTaskId: 'constraint-task', originalName: 'same.txt', mime: 'text/plain', sizeBytes: 1, sha256: 'a'.repeat(64), storageKey: id, source: 'upload', version: 1, uploadedBy: 'constraint-user', deletedAt })
    await db.insert(fileObject).values(file('file-first'))
    await expect(db.insert(fileObject).values(file('file-duplicate'))).rejects.toMatchObject({ cause: { errno: 1062 } })
    await db.insert(fileObject).values({ ...file('file-trailing'), originalName: 'same.txt ' })
    await db.insert(fileObject).values({ ...file('file-name-255'), originalName: 'x'.repeat(255) })
    await expect(db.insert(fileObject).values({ ...file('file-name-256'), originalName: 'x'.repeat(256) })).rejects.toMatchObject({ cause: { errno: 1406 } })
    await db.insert(fileRemoteRef).values({ fileId: 'file-first', scopeHash: 'test', remoteId: 'r'.repeat(300) })
    await db.insert(fileObject).values(file('file-deleted', new Date()))
    await db.insert(thread).values({ id: 'constraint-thread', taskId: 'constraint-task', title: 'test', createdBy: 'constraint-user' })
    for (const id of ['user-1', 'reply-1', 'user-2', 'reply-2']) {
      await db.insert(message).values({ id, threadId: 'constraint-thread', seq: ['user-1', 'reply-1', 'user-2', 'reply-2'].indexOf(id), role: 'user', content: '', status: 'done' })
    }
    const request = (id: string, userMessageId: string, replyMessageId: string, status: string) => ({ id, threadId: 'constraint-thread', userMessageId, replyMessageId, requestedBy: 'constraint-user', status, provider: 'mock', transport: 'inline', model: 'test', bytes: 0, limitBytes: 1 })
    await db.insert(chatRequest).values(request('request-1', 'user-1', 'reply-1', 'pending'))
    await expect(db.insert(chatRequest).values(request('request-2', 'user-2', 'reply-2', 'streaming'))).rejects.toMatchObject({ cause: { errno: 1062 } })
    await db.insert(chatRequest).values(request('request-finished', 'user-2', 'reply-2', 'succeeded'))
    await db.insert(chatRequestInput).values({ requestId: 'request-1', seq: 0, kind: 'file', weight: 'main', fileId: 'file-first', sourceLabel: 's'.repeat(300), bytes: 0 })
    await db.insert(activityLog).values({ id: 'json-activity', type: 'test', userId: 'constraint-user', payload: { nested: { count: 2 } } })
    await db.update(chatRequest).set({ snapshot: { nested: { done: true } } }).where(eq(chatRequest.id, 'request-1'))
    expect((await db.select({ payload: activityLog.payload }).from(activityLog))[0]?.payload).toEqual({ nested: { count: 2 } })
    expect((await db.select({ snapshot: chatRequest.snapshot }).from(chatRequest).where(eq(chatRequest.id, 'request-1')))[0]?.snapshot).toEqual({ nested: { done: true } })
  })
})
