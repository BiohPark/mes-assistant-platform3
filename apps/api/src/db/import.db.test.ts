import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
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
import { DbTasksService } from '../tasks/tasks.service.js'
import { EventsService } from '../events/events.service.js'
import { SrService } from '../sr/sr.service.js'
import * as s from './schema.js'

const at = '2026-09-01T00:00:00.000Z'
const data = Buffer.from('virtual fixture file')
// platform2/src/db/seed/{data,users,assistants}.ts at 2026-09-30T00:00:00Z, serialized as v3 export.
const demoBundle = async () => JSON.parse(await readFile(new URL('./fixtures/demo-v3.json', import.meta.url), 'utf8')) as any
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

  it.each([false, true])('imports the actual demo v3 seed into a %s catalog server', async (seeded) => {
    const isolated = await createTempDb(seeded ? 'demo_seeded' : 'demo_empty')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      if (seeded) await seedCatalog(db)
      const seededCode = seeded ? (await db.select().from(s.code).where(eq(s.code.id, 'assistant_level2:Deviation')))[0] : undefined
      const fixture = await demoBundle()
      const result = await importBundle(fixture, db, new FileStorageService(root), false, { defaultOwner: 'demo-u_so' })
      expect((await db.select({ n: count() }).from(s.task))[0]!.n).toBe(fixture.tables.tasks.length)
      expect((await db.select({ n: count() }).from(s.message))[0]!.n).toBe(fixture.tables.messages.length)
      expect((await db.select().from(s.assistant).where(eq(s.assistant.id, 'fds-writer')))[0]?.ownerId).toBe(seeded ? 'seed-system' : 'u_so')
      if (seeded) {
        expect(result.report['assistants → assistant']).toMatchObject({ skipped: fixture.tables.assistants.length, reason: '서버 카탈로그 값 유지 (차이 있음)' })
        expect((await db.select().from(s.code).where(eq(s.code.id, 'assistant_level2:Deviation')))[0]).toEqual(seededCode)
        expect(result.report['assistants.levels → code']?.reason).toBe('서버 카탈로그 값 유지 (차이 있음)')
      }
    } finally { await pool.end(); await isolated.drop() }
  })

  it('dry-runs and imports the demo seed around server-issued WK and SR codes, then reruns without duplicates', async () => {
    const isolated = await createTempDb('demo_codes')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      await seedCatalog(db)
      await db.insert(s.serviceRequest).values({ id: 'server-sr', code: 'SR-2026-0001', requesterId: 'seed-system', title: 'Server SR', titleSource: 'manual', status: 'submitted' })
      await db.insert(s.serviceRequest).values({ id: 'server-sr-2', code: 'SR-2026-0002', requesterId: 'seed-system', title: 'Server SR 2', titleSource: 'manual', status: 'submitted' })
      await db.insert(s.task).values({ id: 'server-task', code: 'WK-2026-0001', assistantId: 'fds-writer', title: 'Server task', titleSource: 'manual', status: 'todo', ownerId: 'seed-system', priority: 'normal', createdBy: 'seed-system' })
      const fixture = await demoBundle()
      const storage = new FileStorageService(root)
      const before = { tasks: await db.select().from(s.task), srs: await db.select().from(s.serviceRequest) }
      const dry = await importBundle(fixture, db, storage, true)
      expect(dry.codeMappings).toEqual(expect.arrayContaining([
        { kind: 'SR', id: 'sr_seed_0001', from: 'SR-2026-0001', to: 'SR-2026-0006' },
        { kind: 'SR', id: 'sr_seed_0002', from: 'SR-2026-0002', to: 'SR-2026-0007' },
        { kind: 'WK', id: 'task_seed_0001', from: 'WK-2026-0001', to: 'WK-2026-0012' },
      ]))
      expect(await db.select().from(s.task)).toEqual(before.tasks)
      expect(await db.select().from(s.serviceRequest)).toEqual(before.srs)
      const first = await importBundle(fixture, db, storage)
      expect(first.codeMappings).toEqual(dry.codeMappings)
      expect((await db.select().from(s.task).where(eq(s.task.id, 'task_seed_0001')))[0]?.code).toBe('WK-2026-0012')
      expect((await db.select().from(s.serviceRequest).where(eq(s.serviceRequest.id, 'sr_seed_0001')))[0]?.code).toBe('SR-2026-0006')
      expect((await db.select().from(s.taskTag).where(eq(s.taskTag.taskId, 'task_seed_0001'))).map((row) => row.tagKey)).toContain('sr-2026-0007')
      expect((await db.select().from(s.tag).where(eq(s.tag.key, 'sr-2026-0007')))[0]).toMatchObject({ kind: 'sr', label: 'SR-2026-0007' })
      const second = await importBundle(fixture, db, storage)
      expect(second.report['tasks → task']).toMatchObject({ imported: 0, skipped: fixture.tables.tasks.length })
      expect(second.codeMappings).toEqual(first.codeMappings)
      expect((await db.select({ n: count() }).from(s.task))[0]!.n).toBe(fixture.tables.tasks.length + 1)
      expect((await db.select({ n: count() }).from(s.serviceRequest))[0]!.n).toBe(fixture.tables.serviceRequests.length + 2)
      expect((await db.select().from(s.task).where(eq(s.task.id, 'server-task')))[0]?.code).toBe('WK-2026-0001')
      expect((await db.select().from(s.serviceRequest).where(eq(s.serviceRequest.id, 'server-sr')))[0]?.code).toBe('SR-2026-0001')
      const tasks = new DbTasksService(db)
      expect((await tasks.list({ tags: ['SR-2026-0007'] })).map((task) => task.id)).toContain('task_seed_0002')
      expect((await tasks.get('task_seed_0002')).tags).toContain('SR-2026-0007')
      await tasks.removeTag('u_so', 'task_seed_0002', 'SR-2026-0007')
      expect((await tasks.get('task_seed_0002')).tags).not.toContain('SR-2026-0007')
      expect((await tasks.list({ tags: ['SR-2026-0007'] })).map((task) => task.id)).not.toContain('task_seed_0002')
    } finally { await pool.end(); await isolated.drop() }
  })

  it('requires a valid default owner login for the actual demo seed', async () => {
    const isolated = await createTempDb('demo_owner')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      const fixture = await demoBundle()
      await expect(importBundle(fixture, db, undefined, true)).rejects.toThrow(/assistant:fds-writer: 소유자 미지정/)
      await expect(importBundle(fixture, db, undefined, true, { defaultOwner: 'missing-login' })).rejects.toThrow(/assistant:fds-writer: 소유자 미지정/)
      expect(await db.select().from(s.appUser)).toHaveLength(0)
    } finally { await pool.end(); await isolated.drop() }
  })

  it('maps empty nullable user references to NULL', async () => {
    const isolated = await createTempDb('import_null_ref')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      const fixture = structuredClone(base) as any
      fixture.tables.messages[0].authorId = ''
      fixture.tables.tasks[0].completedBy = ''
      await importBundle(fixture, db, new FileStorageService(root))
      expect((await db.select().from(s.message).where(eq(s.message.id, 'fixture-message-b')))[0]?.authorId).toBeNull()
      expect((await db.select().from(s.task).where(eq(s.task.id, 'fixture-task')))[0]?.completedBy).toBeNull()
    } finally { await pool.end(); await isolated.drop() }
  })

  it('rejects changed content and relationships beneath existing parents', async () => {
    const isolated = await createTempDb('import_child_diff')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      const storage = new FileStorageService(root)
      await importBundle(base, db, storage)
      for (const [mutate, label] of [
        [(b: any) => { b.tables.messages[0].content = 'changed answer' }, /message:fixture-message-b/],
        [(b: any) => { b.tables.tasks[0].checklist[0].label = 'changed check' }, /checklist_item:fixture-check/],
        [(b: any) => { b.tables.tasks[0].inputs[0].weight = 'main' }, /task_input:fixture-task\/fixture-file/],
        [(b: any) => { b.tables.messages[0].attachmentIds = ['fixture-file-v2'] }, /message_attachment:fixture-message-b\/fixture-file-v2/],
      ] as const) {
        const changed = structuredClone(base) as any
        mutate(changed)
        await expect(importBundle(changed, db, storage)).rejects.toThrow(label)
      }
      expect((await db.select().from(s.message).where(eq(s.message.id, 'fixture-message-b')))[0]?.content).toBe('Answer')
    } finally { await pool.end(); await isolated.drop() }
  })

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
      const result = await importBundle(v1, drizzle(legacyClient), new FileStorageService(root), false, { defaultOwner: 'demo-fixture-user' })
      expect(result.report['packages → —']).toMatchObject({ imported: 0, skipped: 1, reason: '서버 대응 없음' })
      const db = drizzle(legacyClient)
      expect((await db.select().from(s.task).orderBy(s.task.id)).map((row) => [row.id, row.code, row.titleSource])).toEqual([
        ['fixture-source-task', 'WK-2099-0002', 'manual'], ['fixture-task', 'WK-2099-0001', 'manual'], ['fixture-task_split1', 'WK-2099-0001-2', 'manual'],
      ])
      expect((await db.select().from(s.taskTag)).map((row) => row.tagKey)).toEqual(['sr-2099-0001', 'sr-2099-0001', 'sr-2099-0001'])
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

  it('normalizes imported tag labels (lower-case · # prefix · spaces) without changing keys, links the SR, and reruns idempotently', async () => {
    const isolated = await createTempDb('import_tags')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      const fixture = structuredClone(base) as any
      fixture.tables.tasks[0].tags = ['#sr-2099-0001', ' Change Control ']
      fixture.tables.tasks[1].tags = ['sr-2099-0001', '#change-control']
      const first = await importBundle(fixture, db, new FileStorageService(root))
      expect(first.report['tasks.tags → tag/task_tag']).toMatchObject({ imported: 4 })
      expect((await db.select().from(s.tag).orderBy(s.tag.key)).map((row) => [row.key, row.label, row.kind])).toEqual([['change-control', 'Change-Control', 'keyword'], ['sr-2099-0001', 'SR-2099-0001', 'sr']])
      expect((await db.select().from(s.taskTag).orderBy(s.taskTag.taskId, s.taskTag.tagKey)).map((row) => [row.taskId, row.tagKey])).toEqual([
        ['fixture-source-task', 'change-control'], ['fixture-source-task', 'sr-2099-0001'], ['fixture-task', 'change-control'], ['fixture-task', 'sr-2099-0001']])
      expect((await db.select().from(s.task).orderBy(s.task.id)).map((row) => row.srId)).toEqual(['fixture-sr', 'fixture-sr'])
      expect((await new DbTasksService(db).get('fixture-task')).tags.sort()).toEqual(['Change-Control', 'SR-2099-0001'])
      const second = await importBundle(fixture, db, new FileStorageService(root)) // 같은 번들 재수입 — 충돌이면 여기서 던진다
      expect(second.report['tasks.tags → tag/task_tag']).toMatchObject({ imported: 0, skipped: 4 })
      expect((await db.select({ n: count() }).from(s.tag))[0]!.n).toBe(2)
    } finally { await pool.end(); await isolated.drop() }
  })

  it('restores missing default assistants when importing a v1 bundle into an empty DB', async () => {
    const isolated = await createTempDb('import_v1_defaults')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      const fixture = await demoBundle()
      fixture.version = 1
      fixture.tables.assistants = []
      const result = await importBundle(fixture, db, new FileStorageService(root), false, { defaultOwner: 'demo-u_so' })
      expect(result.report['assistants → assistant']?.imported).toBe(SEED_ASSISTANTS.length)
      expect((await db.select().from(s.assistant)).map((row) => row.id).sort()).toEqual(SEED_ASSISTANTS.map((a) => a.id).sort())
      expect((await db.select().from(s.assistant).where(eq(s.assistant.id, 'deviation-drafter')))[0]?.ownerId).toBe('u_dev2')
      expect((await db.select().from(s.task).where(eq(s.task.id, 'task_seed_0001')))[0]?.assistantId).toBe('urs-analyst')
    } finally { await pool.end(); await isolated.drop() }
  })

  it('imports selected SR attachments onto the canonical intake body message; draft attachments stay candidates only; rerun is idempotent', async () => {
    const isolated = await createTempDb('import_sr')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      const fixture = structuredClone(base) as any
      fixture.tables.serviceRequests[0].body = 'Request body'
      fixture.tables.serviceRequests[0].attachmentIds = ['fixture-sr-file', 'fixture-sr-file-2']
      fixture.tables.serviceRequests.push({ id: 'fixture-draft-a', code: '', requesterId: 'fixture-user', title: '', status: 'draft', createdAt: at, updatedAt: at, attachmentIds: ['fixture-draft-file'] },
        { id: 'fixture-draft-b', code: '', requesterId: 'fixture-user', title: '', status: 'draft', createdAt: at, updatedAt: at })
      fixture.tables.threads.push({ id: 'fixture-draft-a-thread', srId: 'fixture-draft-a', title: '', createdBy: 'fixture-user', createdAt: at })
      fixture.tables.messages.push({ id: 'sr-assistant-message', threadId: 'fixture-sr-thread', role: 'assistant', content: 'Acknowledged',
        createdAt: '2026-09-01T00:00:01.000Z' })
      fixture.tables.files.push({ id: 'fixture-sr-file', originSrId: 'fixture-sr', name: 'selected.txt', uploadedBy: 'fixture-user', uploadedAt: at, blobBase64: data.toString('base64') },
        { id: 'fixture-sr-file-2', originSrId: 'fixture-sr', name: 'second.txt', uploadedBy: 'fixture-user', uploadedAt: '2026-09-01T00:00:02.000Z', blobBase64: data.toString('base64') },
        { id: 'fixture-draft-file', originSrId: 'fixture-draft-a', name: 'draft.txt', uploadedBy: 'fixture-user', uploadedAt: at, blobBase64: data.toString('base64') })
      await importBundle(fixture, db, new FileStorageService(root))
      expect((await db.select().from(s.serviceRequest).where(eq(s.serviceRequest.id, 'fixture-draft-a')))[0]?.code).toBeNull()
      expect((await db.select().from(s.serviceRequest).where(eq(s.serviceRequest.id, 'fixture-draft-b')))[0]?.code).toBeNull()
      const attached = await db.select().from(s.messageAttachment).where(eq(s.messageAttachment.fileId, 'fixture-sr-file'))
      expect(attached).toHaveLength(1)
      // 정본 = SrService.saveContentAttachments와 같은 접수 본문 메시지(role user · kind discussion · authorId null · content = 데모 body), 마지막 seq 뒤에 붙는다.
      expect((await db.select().from(s.message).where(eq(s.message.id, attached[0]!.messageId)))[0]).toMatchObject({
        threadId: 'fixture-sr-thread', role: 'user', kind: 'discussion', authorId: null, content: 'Request body', seq: 2, createdAt: new Date('2026-09-01T00:00:01.000Z'),
      })
      const srs = new SrService(db, new DbTasksService(db), new EventsService())
      expect(await srs.get('fixture-user', 'fixture-sr')).toMatchObject({ attachmentIds: ['fixture-sr-file', 'fixture-sr-file-2'], candidateAttachmentIds: ['fixture-sr-file', 'fixture-sr-file-2'] })
      // 초안의 첨부는 전환 때 사람이 고른다 — 메시지를 만들지 않고 후보(origin_sr_id 파일)로만 남는다.
      expect(await srs.get('fixture-user', 'fixture-draft-a')).toMatchObject({ attachmentIds: [], candidateAttachmentIds: ['fixture-draft-file'] })
      expect(await db.select().from(s.message).where(eq(s.message.threadId, 'fixture-draft-a-thread'))).toEqual([])
      await importBundle(fixture, db, new FileStorageService(root))
      expect(await db.select().from(s.messageAttachment).where(eq(s.messageAttachment.fileId, 'fixture-sr-file'))).toHaveLength(1)
      expect(await db.select().from(s.message).where(eq(s.message.threadId, 'fixture-sr-thread'))).toHaveLength(2)
      expect(await srs.get('fixture-user', 'fixture-sr')).toMatchObject({ attachmentIds: ['fixture-sr-file', 'fixture-sr-file-2'] })
    } finally { await pool.end(); await isolated.drop() }
  })

  it('never attaches SR files to the demo chat message: adds one canonical body message beside it and reruns add nothing', async () => {
    const isolated = await createTempDb('import_sr_message')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      const fixture = structuredClone(base) as any
      fixture.tables.serviceRequests[0].body = 'Request body'
      fixture.tables.serviceRequests[0].attachmentIds = ['fixture-sr-file']
      fixture.tables.messages.push({ id: 'intake-message', threadId: 'fixture-sr-thread', role: 'user', content: 'Request body',
        authorId: 'fixture-user', createdAt: at })
      fixture.tables.files.push({ id: 'fixture-sr-file', originSrId: 'fixture-sr', name: 'selected.txt', uploadedBy: 'fixture-user', uploadedAt: at,
        blobBase64: data.toString('base64') })
      const threadMessages = () => db.select().from(s.message).where(eq(s.message.threadId, 'fixture-sr-thread')).orderBy(s.message.seq)
      await importBundle(fixture, db, new FileStorageService(root))
      expect((await threadMessages()).map((m) => [m.id, m.authorId])).toEqual([['intake-message', 'fixture-user'], ['fixture-sr:import-attachments', null]])
      expect((await db.select().from(s.messageAttachment).where(eq(s.messageAttachment.fileId, 'fixture-sr-file'))).map((row) => row.messageId)).toEqual(['fixture-sr:import-attachments'])
      const srs = new SrService(db, new DbTasksService(db), new EventsService())
      expect(await srs.get('fixture-user', 'fixture-sr')).toMatchObject({ attachmentIds: ['fixture-sr-file'], candidateAttachmentIds: ['fixture-sr-file'] })
      await importBundle(fixture, db, new FileStorageService(root))
      expect((await threadMessages()).map((m) => m.id)).toEqual(['intake-message', 'fixture-sr:import-attachments'])
      expect(await db.select().from(s.messageAttachment).where(eq(s.messageAttachment.fileId, 'fixture-sr-file'))).toHaveLength(1)
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

  it('rejects different IDs and incomplete existing parents, and skips complete reruns', async () => {
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
      await expect(importBundle(changed, db, storage)).rejects.toThrow(/ID 충돌: service_request:fixture-sr/)
      expect(await db.select().from(s.thread).where(eq(s.thread.id, 'foreign-thread'))).toHaveLength(0)
      expect(await db.select().from(s.fileObject).where(eq(s.fileObject.id, 'foreign-image'))).toHaveLength(0)
      const same = structuredClone(base) as any
      same.tables.messages.push({ id: 'foreign-message', threadId: 'fixture-thread', role: 'user', content: 'Foreign', createdAt: '2026-09-01T00:00:02.000Z' })
      same.tables.serviceRequests[0].results.push({ id: 'foreign-result', text: 'Foreign', by: 'fixture-user', at })
      same.tables.assistants.push({ id: 'foreign-assistant', name: 'Foreign', level1: 'Example', level2: 'Draft', ownerId: 'fixture-user', createdBy: 'fixture-user', status: 'open', createdAt: at, updatedAt: at })
      same.tables.tasks.push({ id: 'foreign-task', code: 'WK-2099-0999', assistantId: 'foreign-assistant', title: 'Foreign', ownerId: 'fixture-user', createdBy: 'fixture-user', createdAt: at, tags: ['SR-2099-0001'] })
      same.tables.conversationInputs.push({ id: 'foreign-conversation-input', taskId: 'foreign-task', sourceTaskId: 'fixture-source-task',
        weight: 'reference', mode: 'messages', snapshotId: 'fixture-snapshot', selectedBy: 'fixture-user', selectedAt: at })
      await expect(importBundle(same, db, storage)).rejects.toThrow(/누락된 하위 행:.*message:foreign-message.*shared_result:foreign-result/)
      expect(await db.select().from(s.task).where(eq(s.task.id, 'foreign-task'))).toHaveLength(0)
      expect(await db.select().from(s.message).where(eq(s.message.id, 'foreign-message'))).toHaveLength(0)
      expect(await db.select().from(s.sharedResult).where(eq(s.sharedResult.id, 'foreign-result'))).toHaveLength(0)
      const rerun = await importBundle(base, db, storage)
      expect(rerun.report['tasks → task']).toMatchObject({ imported: 0, skipped: 2 })
      const catalogDifference = structuredClone(base) as any
      catalogDifference.tables.assistants[0].name = 'Different assistant'
      const catalog = await importBundle(catalogDifference, db, storage)
      expect(catalog.report['assistants → assistant']).toMatchObject({ skipped: 1, reason: '서버 카탈로그 값 유지 (차이 있음)' })
      expect((await db.select().from(s.assistant).where(eq(s.assistant.id, 'fixture-assistant')))[0]?.name).toBe('Fixture Assistant')
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

  it('imports files and snapshots whose source task already exists when a new task references them', async () => {
    const isolated = await createTempDb('import_cross_ref')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      const storage = new FileStorageService(root)
      await importBundle(base, db, storage)
      const fixture = structuredClone(base) as any
      fixture.tables.files = [{ id: 'cross-file', originTaskId: 'fixture-source-task', name: 'cross.txt', uploadedBy: 'fixture-user', uploadedAt: at, blobBase64: data.toString('base64') }]
      fixture.tables.contextSnapshots = [{ id: 'cross-snapshot', sourceTaskId: 'fixture-source-task', mode: 'messages', messageIds: ['fixture-source-message'],
        createdBy: 'fixture-user', createdAt: at }]
      fixture.tables.tasks = [{ id: 'cross-task', code: 'WK-2099-0003', assistantId: 'fixture-assistant', title: 'Cross reference', ownerId: 'fixture-user',
        createdBy: 'fixture-user', createdAt: at, inputs: [{ fileId: 'cross-file', selectedBy: 'fixture-user', selectedAt: at }] }]
      fixture.tables.conversationInputs = [{ id: 'cross-input', taskId: 'cross-task', sourceTaskId: 'fixture-source-task', weight: 'reference',
        mode: 'messages', snapshotId: 'cross-snapshot', selectedBy: 'fixture-user', selectedAt: at }]
      fixture.tables.serviceRequests = []
      fixture.tables.threads = []
      fixture.tables.messages = []
      fixture.tables.notes = []
      fixture.tables.activity = []
      await importBundle(fixture, db, storage)
      expect(await db.select().from(s.fileObject).where(eq(s.fileObject.id, 'cross-file'))).toHaveLength(1)
      expect(await db.select().from(s.contextSnapshot).where(eq(s.contextSnapshot.id, 'cross-snapshot'))).toHaveLength(1)
      expect(await db.select().from(s.taskInput).where(eq(s.taskInput.taskId, 'cross-task'))).toHaveLength(1)
      expect(await db.select().from(s.conversationInput).where(eq(s.conversationInput.id, 'cross-input'))).toHaveLength(1)
    } finally { await pool.end(); await isolated.drop() }
  })

  it('rejects multiple SR links by default and uses the earliest only with explicit opt-in', async () => {
    const isolated = await createTempDb('import_multi_sr')
    const pool = createPool(isolated.url)
    try {
      await runMigrations(isolated.url)
      const db = drizzle(pool)
      const fixture = structuredClone(base) as any
      fixture.tables.serviceRequests.push({ id: 'older-sr', code: 'SR-2099-0000', requesterId: 'fixture-user', title: 'Older', status: 'submitted',
        createdAt: '2026-08-01T00:00:00.000Z', updatedAt: at })
      fixture.tables.tasks[0].tags = ['SR-2099-0001', 'SR-2099-0000']
      await expect(importBundle(fixture, db, new FileStorageService(root))).rejects.toThrow(/다중 SR 업무: fixture-task.*SR-2099-0000.*SR-2099-0001/)
      expect(await db.select().from(s.task)).toHaveLength(0)
      const result = await importBundle(fixture, db, new FileStorageService(root), false, { allowMultiSr: true })
      expect((await db.select().from(s.task).where(eq(s.task.id, 'fixture-task')))[0]?.srId).toBe('older-sr')
      expect(result.report['tasks.tags → task.sr_id']).toMatchObject({ skipped: 1, reason: '다중 SR 연결 손실' })
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

it('imports ordered paths only for new assistants, dry-runs without writes and preserves server paths on rerun', async () => {
  const isolated = await createTempDb('import_paths'); const pool = createPool(isolated.url)
  try {
    await runMigrations(isolated.url); const db = drizzle(pool)
    const fixture = structuredClone(base) as any
    fixture.tables.assistants[0].link1 = 'https://example.invalid/legacy'
    fixture.tables.assistants[0].classifications = [{ level1: 'Virtual', level2: 'One' }, { level1: 'Secondary', level2: 'Two' }]
    const storage = new FileStorageService(root)
    const dry = await importBundle(fixture, db, storage, true)
    expect((dry as unknown as { link1Overrides: number }).link1Overrides).toBe(1)
    expect(dry.report['assistants.classifications → assistant_classification']).toMatchObject({ imported: 2 })
    expect(await db.select().from(s.assistant)).toEqual([])
    await importBundle(fixture, db, storage)
    const [rows] = await pool.query('select * from assistant_classification where assistant_id = ? order by sort_order', ['fixture-assistant'])
    expect(rows).toMatchObject([{ level1_code_id: 'assistant_level1:Virtual', level2_code_id: 'assistant_level2:One', sort_order: 0 }, { level1_code_id: 'assistant_level1:Secondary', level2_code_id: 'assistant_level2:Two', sort_order: 1 }])
    fixture.tables.assistants[0].classifications.reverse()
    await importBundle(fixture, db, storage)
    const [again] = await pool.query('select * from assistant_classification where assistant_id = ? order by sort_order', ['fixture-assistant'])
    expect(again).toEqual(rows)
    const [parent] = await db.select().from(s.assistant).where(eq(s.assistant.id, 'fixture-assistant'))
    expect(parent).toMatchObject({ level1CodeId: 'assistant_level1:Virtual', level2CodeId: 'assistant_level2:One' })
  } finally { await pool.end(); await isolated.drop() }
})


it.each([false, true])('normalizes legacy import names without creating ambiguous codes; existing=%s', async existing => {
  const isolated = await createTempDb('import_normalized_paths'); const pool = createPool(isolated.url)
  try {
    await runMigrations(isolated.url); const db = drizzle(pool)
    if (existing) {
      await db.insert(s.codeGroup).values({ key: 'assistant_level1', name: 'Level 1' })
      await db.insert(s.code).values({ id: 'manual-virtual', groupKey: 'assistant_level1', code: 'Virtual', name: 'Café Virtual', isAuto: false })
    }
    const fixture = structuredClone(base) as any
    fixture.tables.assistants[0].level1 = '  Cafe\u0301   Virtual  '
    fixture.tables.assistants[0].level2 = '  Draft  '
    await importBundle(fixture, db, new FileStorageService(root))
    const group = await db.select().from(s.code).where(eq(s.code.groupKey, 'assistant_level1'))
    expect(group).toHaveLength(1)
    expect(group[0]).toMatchObject({ name: 'Café Virtual' })
    const [parent] = await db.select().from(s.assistant).where(eq(s.assistant.id, 'fixture-assistant'))
    expect(parent?.level1CodeId).toBe(existing ? 'manual-virtual' : 'assistant_level1:Café Virtual')
  } finally { await pool.end(); await isolated.drop() }
})

})
