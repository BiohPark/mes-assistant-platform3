import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/mysql2'
import { count, eq } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'
import { createPool } from './connection.js'
import { runMigrations } from './migrate.js'
import { createTempDb } from '../test/tempDb.js'
import { FileStorageService } from '../files/fileStorage.service.js'
import { verifyPassword } from '../auth/password.js'
import { importBundle } from './import.js'
import * as s from './schema.js'

const at = '2026-09-01T00:00:00.000Z'
const data = Buffer.from('virtual fixture file')
const base = {
  format: 'mes-assistant-hub', version: 3, exportedAt: at,
  tables: {
    users: [{ id: 'fixture-user', name: 'Fixture User', role: 'requester', initials: 'FU', color: '#123456', isSystemOwner: true }],
    assistants: [{ id: 'fixture-assistant', name: 'Fixture Assistant', level1: 'Example', level2: 'Draft', ownerId: 'fixture-user', createdBy: 'fixture-user',
      status: 'open', order: 1, color: '#123456', checklistTemplate: [{ id: 'fixture-template', label: 'Check', required: true }] }],
    serviceRequests: [{ id: 'fixture-sr', code: 'SR-2099-0001', requesterId: 'fixture-user', title: 'Request', status: 'submitted',
      threadId: 'fixture-sr-thread', createdAt: at, updatedAt: at, results: [] }],
    tasks: [{ id: 'fixture-task', code: 'WK-2099-0001', assistantId: 'fixture-assistant', title: 'Draft', status: 'in_progress', ownerId: 'fixture-user',
      createdBy: 'fixture-user', createdAt: at, priority: 'normal', tags: ['SR-2099-0001'], assigneeIds: ['fixture-user'],
      inputs: [{ fileId: 'fixture-file', weight: 'reference', selectedBy: 'fixture-user', selectedAt: at }], outputFileIds: ['fixture-file-v2'],
      checklist: [{ id: 'fixture-check', label: 'Check', required: true, checked: false }] },
      { id: 'fixture-source-task', code: 'WK-2099-0002', assistantId: 'fixture-assistant', title: 'Source', status: 'done', ownerId: 'fixture-user',
        createdBy: 'fixture-user', createdAt: at, priority: 'normal', tags: ['SR-2099-0001'], inputs: [], outputFileIds: [], checklist: [] }],
    threads: [{ id: 'fixture-thread', taskId: 'fixture-task', title: 'Draft', createdBy: 'fixture-user', createdAt: at },
      { id: 'fixture-source-thread', taskId: 'fixture-source-task', title: 'Source', createdBy: 'fixture-user', createdAt: at },
      { id: 'fixture-sr-thread', srId: 'fixture-sr', title: 'Request', createdBy: 'fixture-user', createdAt: at }],
    messages: [{ id: 'fixture-message-b', threadId: 'fixture-thread', role: 'assistant', content: 'Answer', status: 'done', createdAt: '2026-09-01T00:00:01.000Z', attachmentIds: ['fixture-file'] },
      { id: 'fixture-message-a', threadId: 'fixture-thread', role: 'user', content: 'Question', status: 'done', authorId: 'fixture-user', createdAt: at },
      { id: 'fixture-source-message', threadId: 'fixture-source-thread', role: 'assistant', content: 'Source answer', status: 'done', createdAt: at }],
    files: [{ id: 'fixture-file-v2', originTaskId: 'fixture-task', name: 'answer.txt', mime: 'text/plain', source: 'assistant', uploadedBy: 'fixture-user',
      uploadedAt: at, version: 2, previousId: 'fixture-file', blobBase64: Buffer.from('virtual version two').toString('base64') },
      { id: 'fixture-file', originTaskId: 'fixture-task', name: 'answer.txt', mime: 'text/plain', source: 'assistant', uploadedBy: 'fixture-user',
        uploadedAt: at, version: 1, blobBase64: data.toString('base64'), remoteIds: { secret: 'remote-cache' } }],
    notes: [{ id: 'fixture-note', taskId: 'fixture-task', authorId: 'fixture-user', content: 'Virtual note', createdAt: at, attachmentIds: ['fixture-file'] }],
    activity: [{ id: 'fixture-activity', type: 'task.created', userId: 'fixture-user', taskId: 'fixture-task', at, payload: { virtual: true } }],
    contextSnapshots: [{ id: 'fixture-snapshot', sourceTaskId: 'fixture-source-task', mode: 'messages', upToMessageId: 'fixture-source-message',
      messageIds: ['fixture-source-message'], createdBy: 'fixture-user', createdAt: at }],
    conversationInputs: [{ id: 'fixture-conversation-input', taskId: 'fixture-task', sourceTaskId: 'fixture-source-task', weight: 'reference',
      mode: 'messages', snapshotId: 'fixture-snapshot', selectedBy: 'fixture-user', selectedAt: at }],
    settings: [{ id: 'app', srIntakeAssistantId: 'fixture-assistant', requestBudgetBytes: 8192, llm: { apiKey: 'fixture-secret', baseUrl: 'https://example.invalid', model: 'private' } }],
  },
} as const

describe('demo bundle DB import', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  let root: string
  beforeAll(async () => { temp = await createTempDb('import'); await runMigrations(temp.url); client = createPool(temp.url); root = await mkdtemp(join(tmpdir(), 'mes-import-')) })
  afterAll(async () => { await client?.end(); await temp?.drop(); if (root) await rm(root, { recursive: true, force: true }) })

  it('imports v3 relations, sequence, file, credentials and excludes secrets; rerun is idempotent', async () => {
    const db = drizzle(client)
    const storage = new FileStorageService(root)
    const first = await importBundle(base, db, storage)
    expect(first.report['users → app_user']?.imported).toBe(1)
    expect(first.credentials).toHaveLength(1)
    expect(await verifyPassword(first.credentials[0]!.password, (await db.select().from(s.appUser))[0]!.passwordHash!)).toBe(true)
    expect((await db.select().from(s.appUser))[0]).toMatchObject({ mustChangePassword: true, isSystemOwner: true, isBusinessOwner: true })
    expect((await db.select().from(s.task))[0]).toMatchObject({ srId: 'fixture-sr' })
    expect((await db.select().from(s.message).where(eq(s.message.threadId, 'fixture-thread')).orderBy(s.message.seq)).map((m) => [m.id, m.seq])).toEqual([['fixture-message-a', 1], ['fixture-message-b', 2]])
    expect((await db.select().from(s.taskInput))[0]).toMatchObject({ taskId: 'fixture-task', fileId: 'fixture-file', weight: 'reference' })
    expect((await db.select().from(s.contextSnapshotMessage))[0]).toMatchObject({ snapshotId: 'fixture-snapshot', messageId: 'fixture-source-message', seq: 0 })
    expect((await db.select().from(s.conversationInput))[0]).toMatchObject({ taskId: 'fixture-task', sourceTaskId: 'fixture-source-task', snapshotId: 'fixture-snapshot' })
    expect((await db.select().from(s.fileObject).where(eq(s.fileObject.id, 'fixture-file-v2')))[0]).toMatchObject({ isOutput: true, version: 2, previousId: 'fixture-file' })
    const [file] = await db.select().from(s.fileObject).where(eq(s.fileObject.id, 'fixture-file'))
    expect(Buffer.from(await storage.read(file!.storageKey))).toEqual(data)
    expect(await db.select().from(s.fileRemoteRef)).toHaveLength(0)
    expect(await db.select().from(s.appSetting)).toHaveLength(2)
    expect(JSON.stringify(await db.select().from(s.appSetting))).not.toContain('fixture-secret')
    expect(JSON.stringify(await db.select().from(s.appSetting))).not.toContain('example.invalid')
    const second = await importBundle(base, db, storage)
    expect(second.credentials).toHaveLength(0)
    expect(second.report['users → app_user']).toMatchObject({ imported: 0, skipped: 1 })
    expect((await db.select({ n: count() }).from(s.message))[0]!.n).toBe(3)
    expect((await db.select({ n: count() }).from(s.fileObject))[0]!.n).toBe(2)
  })

  it('dry-run writes nothing and failed import removes files', async () => {
    const db = drizzle(client)
    const storage = new FileStorageService(root)
    const v1 = { ...base, version: 1, tables: { ...base.tables, users: [{ ...base.tables.users[0], id: 'fixture-user-b' }],
      files: [{ ...base.tables.files[1], id: 'fixture-dry-file', name: 'dry.txt' }] } }
    const before = (await db.select({ n: count() }).from(s.appUser))[0]!.n
    const beforeFiles = (await readdir(root, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).length
    const dry = await importBundle(v1, db, storage, true)
    expect(dry.report['users → app_user']?.imported).toBe(1)
    expect(dry.report['files → file_object']?.imported).toBe(1)
    expect((await db.select({ n: count() }).from(s.appUser))[0]!.n).toBe(before)
    expect((await readdir(root, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile())).toHaveLength(beforeFiles)
    const bad = { ...base, tables: { ...base.tables,
      files: [{ ...base.tables.files[1], id: 'fixture-file-b', name: 'failed.txt' }],
      notes: [{ ...base.tables.notes[0], id: 'fixture-note-b', taskId: 'missing-task' }],
    } }
    await expect(importBundle(bad, db, storage)).rejects.toThrow()
    expect((await db.select().from(s.fileObject).where(eq(s.fileObject.id, 'fixture-file-b')))).toHaveLength(0)
    expect((await readdir(root, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile())).toHaveLength(beforeFiles)
  })

  it('upgrades and imports a v1 task with SR tag and reference input', async () => {
    const legacyDb = await createTempDb('import_v1')
    const legacyClient = createPool(legacyDb.url)
    try {
      await runMigrations(legacyDb.url)
      const v1 = structuredClone(base) as any
      v1.version = 1
      const task = v1.tables.tasks[0]
      delete task.inputs
      delete task.titleSource
      task.inputFileIds = ['fixture-file']
      task.srIds = ['fixture-sr']
      task.tags = []
      task.activeThreadId = 'fixture-thread'
      v1.tables.packages = [{ id: 'fixture-package' }]
      v1.tables.threads.push({ id: 'fixture-thread-two', taskId: 'fixture-task', title: 'Follow up', createdBy: 'fixture-user', createdAt: '2026-09-02T00:00:00.000Z' })
      const result = await importBundle(v1, drizzle(legacyClient), new FileStorageService(root))
      expect(result.report['packages → —']).toMatchObject({ imported: 0, skipped: 1, reason: '서버 대응 없음' })
      const db = drizzle(legacyClient)
      expect((await db.select().from(s.task).orderBy(s.task.id)).map((row) => [row.id, row.code, row.titleSource])).toEqual([
        ['fixture-source-task', 'WK-2099-0002', 'manual'], ['fixture-task', 'WK-2099-0001', 'manual'], ['fixture-task_split1', 'WK-2099-0001-2', 'manual'],
      ])
      expect((await db.select().from(s.taskTag)).map((row) => row.tagKey)).toEqual(['SR-2099-0001', 'SR-2099-0001', 'SR-2099-0001'])
      expect((await db.select().from(s.taskInput))[0]).toMatchObject({ fileId: 'fixture-file', weight: 'reference' })
      expect((await db.select().from(s.thread).where(eq(s.thread.id, 'fixture-thread-two')))[0]).toMatchObject({ taskId: 'fixture-task_split1' })
    } finally { await legacyClient.end(); await legacyDb.drop() }
  })
})
