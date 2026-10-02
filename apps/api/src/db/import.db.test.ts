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
import { seedCatalog } from './seed.js'
import { SEED_ASSISTANTS } from './seedData.js'
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
    const isolated = await createTempDb('import_dry')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      const storage = new FileStorageService(root)
      const beforeFiles = (await readdir(root, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).length
      const dry = await importBundle(base, db, storage, true)
      expect(dry.report['users → app_user']?.imported).toBe(1)
      expect(dry.report['files → file_object']?.imported).toBe(2)
      expect((await db.select({ n: count() }).from(s.appUser))[0]!.n).toBe(0)
      expect((await readdir(root, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile())).toHaveLength(beforeFiles)
      const bad = structuredClone(base) as any
      bad.tables.notes[0].taskId = 'missing-task'
      await expect(importBundle(bad, db, storage)).rejects.toThrow()
      expect((await db.select().from(s.fileObject))).toHaveLength(0)
      expect((await readdir(root, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile())).toHaveLength(beforeFiles)
    } finally { await pool.end(); await isolated.drop() }
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
      task.checklistReview = { by: 'fixture-user', at, met: 1, total: 1, source: 'rule', items: [{ itemId: 'fixture-check', met: true }] }
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
      expect((await db.select().from(s.checklistItem).orderBy(s.checklistItem.id)).map((row) => [row.id, row.taskId])).toEqual([
        ['fixture-check', 'fixture-task'], ['fixture-task_split1:fixture-check', 'fixture-task_split1'],
      ])
      expect((await db.select().from(s.checklistReviewItem).orderBy(s.checklistReviewItem.reviewId)).map((row) => [row.reviewId, row.itemId])).toEqual([
        ['fixture-task:import-review', 'fixture-check'], ['fixture-task_split1:import-review', 'fixture-task_split1:fixture-check'],
      ])
    } finally { await legacyClient.end(); await legacyDb.drop() }
  })

  it('imports multiple draft SRs and selected SR attachments through the intake thread', async () => {
    const isolated = await createTempDb('import_sr')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      const fixture = structuredClone(base) as any
      fixture.tables.serviceRequests[0].attachmentIds = ['fixture-sr-file']
      fixture.tables.serviceRequests.push({ id: 'fixture-draft-a', code: '', requesterId: 'fixture-user', title: '', status: 'draft', createdAt: at, updatedAt: at },
        { id: 'fixture-draft-b', code: '', requesterId: 'fixture-user', title: '', status: 'draft', createdAt: at, updatedAt: at })
      fixture.tables.files.push({ id: 'fixture-sr-file', originSrId: 'fixture-sr', name: 'selected.txt', uploadedBy: 'fixture-user', uploadedAt: at, blobBase64: data.toString('base64') })
      await importBundle(fixture, db, new FileStorageService(root))
      expect((await db.select().from(s.serviceRequest).where(eq(s.serviceRequest.id, 'fixture-draft-a')))[0]?.code).toBeNull()
      expect((await db.select().from(s.serviceRequest).where(eq(s.serviceRequest.id, 'fixture-draft-b')))[0]?.code).toBeNull()
      const attached = await db.select().from(s.messageAttachment).where(eq(s.messageAttachment.fileId, 'fixture-sr-file'))
      expect(attached).toHaveLength(1)
      expect((await db.select().from(s.message).where(eq(s.message.id, attached[0]!.messageId)))[0]?.threadId).toBe('fixture-sr-thread')
    } finally { await pool.end(); await isolated.drop() }
  })

  it.each([false, true])('imports a task and message referencing a seeded assistant (bundle row: %s)', async (withAssistant) => {
    const isolated = await createTempDb('import_seed_ref')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      await seedCatalog(db)
      const fixture = { format: 'mes-assistant-hub', version: 3, tables: {
        users: [{ id: 'seed-ref-user', name: 'Seed Ref', role: 'member', initials: 'SR', color: '#123456' }],
        assistants: withAssistant ? [SEED_ASSISTANTS[0]] : [],
        tasks: [{ id: 'seed-ref-task', code: 'WK-2099-SEED-REF', assistantId: SEED_ASSISTANTS[0]!.id, title: 'Seed reference',
          ownerId: 'seed-system', createdBy: 'seed-ref-user', createdAt: at }],
        threads: [{ id: 'seed-ref-thread', taskId: 'seed-ref-task', title: 'Seed reference', createdBy: 'seed-ref-user', createdAt: at }],
        messages: [{ id: 'seed-ref-message', threadId: 'seed-ref-thread', role: 'user', content: 'Seed reference message',
          authorId: 'seed-system', createdAt: at }],
        activity: [{ id: 'seed-ref-activity', type: 'assistant.viewed', userId: 'seed-ref-user', assistantId: SEED_ASSISTANTS[0]!.id, at }],
      } }
      const dry = await importBundle(fixture, db, undefined, true)
      expect(dry.report['tasks → task']).toMatchObject({ imported: 1, skipped: 0 })
      expect(dry.report['threads → thread']).toMatchObject({ imported: 1, skipped: 0 })
      expect(dry.report['messages → message']).toMatchObject({ imported: 1, skipped: 0 })
      expect(dry.report['activity → activity_log']).toMatchObject({ imported: 1, skipped: 0 })
      expect(await db.select().from(s.task).where(eq(s.task.id, 'seed-ref-task'))).toHaveLength(0)
      const result = await importBundle(fixture, db, undefined)
      expect(result.report['tasks → task']?.imported).toBe(1)
      expect((await db.select().from(s.task).where(eq(s.task.id, 'seed-ref-task')))[0]).toMatchObject({ assistantId: SEED_ASSISTANTS[0]!.id, ownerId: 'seed-system' })
      expect((await db.select().from(s.message).where(eq(s.message.id, 'seed-ref-message')))[0]).toMatchObject({ threadId: 'seed-ref-thread', authorId: 'seed-system' })
      expect((await db.select().from(s.activityLog).where(eq(s.activityLog.id, 'seed-ref-activity')))[0]?.assistantId).toBe(SEED_ASSISTANTS[0]!.id)
    } finally { await pool.end(); await isolated.drop() }
  })

  it('aborts the whole import when a referenced assistant does not exist', async () => {
    const isolated = await createTempDb('import_missing_ref')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const fixture = { format: 'mes-assistant-hub', version: 3, tables: {
        users: [{ id: 'missing-ref-user', name: 'Missing Ref', role: 'member', initials: 'MR', color: '#123456' }],
        tasks: [{ id: 'missing-ref-task', code: 'WK-2099-MISSING-REF', assistantId: 'missing-assistant', title: 'Missing',
          ownerId: 'missing-ref-user', createdBy: 'missing-ref-user', createdAt: at }],
      } }
      const db = drizzle(pool)
      await expect(importBundle(fixture, db, undefined)).rejects.toThrow()
      expect(await db.select().from(s.appUser)).toHaveLength(0)
      expect(await db.select().from(s.task)).toHaveLength(0)
    } finally { await pool.end(); await isolated.drop() }
  })

  it('rejects different IDs before adding descendants, and skips equal existing parents with all descendants', async () => {
    const isolated = await createTempDb('import_collision')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      const storage = new FileStorageService(root)
      await importBundle(base, db, storage)
      const changed = structuredClone(base) as any
      changed.tables.assistants[0].name = 'Different assistant'
      changed.tables.assistants[0].imageId = 'foreign-image'
      changed.tables.files.push({ id: 'foreign-image', name: 'image.png', uploadedBy: 'fixture-user', uploadedAt: at, blobBase64: data.toString('base64') })
      changed.tables.serviceRequests[0].title = 'Different request'
      changed.tables.threads.push({ id: 'foreign-thread', srId: 'fixture-sr', title: 'Foreign', createdBy: 'fixture-user', createdAt: at })
      await expect(importBundle(changed, db, storage)).rejects.toThrow(/ID 충돌: assistant:fixture-assistant, service_request:fixture-sr/)
      expect(await db.select().from(s.thread).where(eq(s.thread.id, 'foreign-thread'))).toHaveLength(0)
      expect(await db.select().from(s.fileObject).where(eq(s.fileObject.id, 'foreign-image'))).toHaveLength(0)
      const same = structuredClone(base) as any
      same.tables.messages.push({ id: 'foreign-message', threadId: 'fixture-thread', role: 'user', content: 'Foreign', createdAt: at })
      same.tables.serviceRequests[0].results.push({ id: 'foreign-result', text: 'Foreign', by: 'fixture-user', at })
      same.tables.assistants.push({ id: 'foreign-assistant', name: 'Foreign', level1: 'Example', level2: 'Draft', ownerId: 'fixture-user', createdBy: 'fixture-user', status: 'open', createdAt: at, updatedAt: at })
      same.tables.tasks.push({ id: 'foreign-task', code: 'WK-2099-0999', assistantId: 'foreign-assistant', title: 'Foreign', ownerId: 'fixture-user', createdBy: 'fixture-user', createdAt: at, tags: ['SR-2099-0001'] })
      same.tables.conversationInputs.push({ id: 'foreign-conversation-input', taskId: 'foreign-task', sourceTaskId: 'fixture-source-task',
        weight: 'reference', mode: 'messages', snapshotId: 'fixture-snapshot', selectedBy: 'fixture-user', selectedAt: at })
      const result = await importBundle(same, db, storage)
      expect(result.report['messages → message']?.skipped).toBe(4)
      expect(result.report['tasks → task']).toMatchObject({ imported: 1, skipped: 2 })
      expect(await db.select().from(s.task).where(eq(s.task.id, 'foreign-task'))).toHaveLength(1)
      expect((await db.select().from(s.conversationInput).where(eq(s.conversationInput.id, 'foreign-conversation-input')))[0]).toMatchObject({ sourceTaskId: 'fixture-source-task', snapshotId: 'fixture-snapshot' })
      expect(await db.select().from(s.message).where(eq(s.message.id, 'foreign-message'))).toHaveLength(0)
      expect(await db.select().from(s.sharedResult).where(eq(s.sharedResult.id, 'foreign-result'))).toHaveLength(0)
      const messageCollision = { format: 'mes-assistant-hub', version: 3, tables: {
        users: [base.tables.users[0]],
        assistants: [{ id: 'second-assistant', name: 'Second', level1: 'Example', level2: 'Draft', ownerId: 'fixture-user', createdBy: 'fixture-user', status: 'open', createdAt: at, updatedAt: at }],
        tasks: [{ id: 'second-task', code: 'WK-2099-1000', assistantId: 'second-assistant', title: 'Second', ownerId: 'fixture-user', createdBy: 'fixture-user', createdAt: at }],
        threads: [{ id: 'second-thread', taskId: 'second-task', title: 'Second', createdBy: 'fixture-user', createdAt: at }],
        messages: [{ id: 'fixture-message-a', threadId: 'second-thread', role: 'user', content: 'Different', createdAt: at }],
      } }
      await expect(importBundle(messageCollision, db, storage)).rejects.toThrow(/ID 충돌: message:fixture-message-a/)
      expect(await db.select().from(s.thread).where(eq(s.thread.id, 'second-thread'))).toHaveLength(0)
    } finally { await pool.end(); await isolated.drop() }
  })

  it('checks dry-run constraints, invalid names, and reports requestedBy', async () => {
    const isolated = await createTempDb('import_validation')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      const storage = new FileStorageService(root)
      const missing = structuredClone(base) as any
      missing.tables.notes[0].taskId = 'missing-task'
      await expect(importBundle(missing, db, undefined, true)).rejects.toThrow()
      expect(await db.select().from(s.appUser)).toHaveLength(0)
      const invalid = structuredClone(base) as any
      invalid.tables.files[0].name = 'CON.txt'
      await expect(importBundle(invalid, db, storage, true)).rejects.toThrow(/파일 이름/)
      const invalidThread = structuredClone(base) as any
      delete invalidThread.tables.threads[0].taskId
      await expect(importBundle(invalidThread, db, undefined, true)).rejects.toThrow(/taskId 또는 srId/)
      const fixture = structuredClone(base) as any
      fixture.tables.messages[0].requestedBy = 'fixture-user'
      const result = await importBundle(fixture, db, undefined, true)
      expect(result.report['messages.requestedBy → —']).toMatchObject({ skipped: 1 })
      expect(await db.select().from(s.appUser)).toHaveLength(0)
    } finally { await pool.end(); await isolated.drop() }
  })
})
