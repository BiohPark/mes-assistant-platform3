import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { drizzle } from 'drizzle-orm/mysql2'
import { DB, DB_CLIENT, type Db } from '../db/db.module.js'
import { eq } from 'drizzle-orm'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { CONFIG } from '../config/config.js'
import { SESSION_STORE, type AuthUser } from '../auth/session.service.js'
import type { Pool } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPool } from '../db/connection.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { activityLog, appSetting, appUser, assistant, chatRequest, dbLock, fileObject, notification, serviceRequest, sharedResult, task } from '../db/schema.js'
import { loadConfig } from '../config/config.js'
import { RequestsService } from '../requests/requests.service.js'
import { createTempDb } from '../test/tempDb.js'
import { DbTasksService } from '../tasks/tasks.service.js'
import { EventsService } from '../events/events.service.js'
import { SrService } from './sr.service.js'
import { assertFileAccess, assertSrAccess, assertTaskAccess, assertThreadAccess } from './access.js'
import { EventsController } from '../events/events.controller.js'
import { EventEmitter } from 'node:events'
import type { Response } from 'express'
import { vi } from 'vitest'

describe('SR DB (demo conversations 105/114/121; notifications 35/57/69)', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  let sr: SrService
  let db: Db
  let assistantId: string
  beforeAll(async () => {
    temp = await createTempDb('sr')
    await runMigrations(temp.url)
    client = createPool(temp.url)
    db = drizzle(client)
    await seedCatalog(db)
    await db.insert(appUser).values([
      { id: 'requester', name: 'Requester', initials: 'R', color: '#123456', isBusinessOwner: true },
      { id: 'other', name: 'Other', initials: 'O', color: '#123456', isBusinessOwner: true },
      { id: 'staff', name: 'Staff', initials: 'S', color: '#123456' },
      { id: 'owner', name: 'Owner', initials: 'A', color: '#123456', isSystemOwner: true },
    ])
    assistantId = (await db.select().from(assistant))[0]!.id
    await db.update(assistant).set({ ownerId: 'staff' }).where(eq(assistant.id, assistantId))
    await db.update(appSetting).set({ value: assistantId }).where(eq(appSetting.key, 'srIntakeAssistantId'))
    sr = new SrService(db, new DbTasksService(db), new EventsService())
  })
  afterAll(async () => { await client?.end(); await temp?.drop() })

  it('limits requester listing and details to their own SR', async () => {
    const mine = await sr.create('requester')
    const another = await sr.create('other')
    expect((await sr.list('requester')).map((x) => x.id)).toEqual([mine.id])
    await expect(sr.get('other', mine.id)).rejects.toMatchObject({ status: 403 })
    await expect(assertThreadAccess(db, 'requester', another.threadId)).rejects.toMatchObject({ status: 403 })
    expect(await sr.list('staff')).toHaveLength(2)
  })

  it('종료된 응답 기록이 있는 접수 전 초안은 삭제하지 않는다', async () => {
    const draft = await sr.create('requester')
    const provider = { kind: 'mock' as const, ping: async () => ({ ok: true, detail: '' }), listModels: async () => ['glm-5.2'],
      async *stream() { yield { type: 'delta' as const, text: '응답' }; yield { type: 'done' as const } } }
    const requests = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' }), provider)
    expect((await sr.get('requester', draft.id)).hasRequests).toBe(false)
    const started = await requests.start('requester', draft.threadId, { content: '접수 전 대화' }, `keep-${draft.id}`)
    await started.done
    expect((await sr.get('requester', draft.id)).hasRequests).toBe(true)
    await expect(sr.delete('requester', draft.id)).rejects.toMatchObject({ status: 409 })
    expect((await db.select({ id: chatRequest.id }).from(chatRequest).where(eq(chatRequest.id, started.id)))).toHaveLength(1)
  })

  it('submits with unique code, notifies intake owner, and protects manual title', async () => {
    const draft = await sr.create('requester')
    const submitted = await sr.submit('requester', draft.id, { title: 'AI 제목', titleSource: 'ai', body: '본문', attachmentIds: [] })
    expect(submitted.code).toMatch(/^SR-\d{4}-\d{4}$/)
    expect(await db.select({ type: activityLog.type, payload: activityLog.payload }).from(activityLog).where(eq(activityLog.srId, draft.id)))
      .toContainEqual({ type: 'sr.status_changed', payload: { from: 'draft', to: 'submitted' } })
    expect((await db.select().from(notification).where(eq(notification.userId, 'staff'))).length).toBeGreaterThan(0)
    await expect(sr.title('staff', draft.id, '침범')).rejects.toMatchObject({ status: 403 })
    expect(await sr.title('owner', draft.id, '사람 제목')).toMatchObject({ title: '사람 제목', titleSource: 'manual' })
    await expect(sr.content('staff', draft.id, { title: '침범', body: '', attachmentIds: [] })).rejects.toMatchObject({ status: 403 })
    expect(await sr.content('owner', draft.id, { title: '사람 제목', titleSource: 'ai', body: '수정 본문', attachmentIds: [] }))
      .toMatchObject({ body: '수정 본문', titleSource: 'manual' })
    await expect(sr.submit('requester', draft.id, { title: '또 다른 AI', titleSource: 'ai', body: '', attachmentIds: [] })).rejects.toMatchObject({ status: 409 })
  })

  it('starts a tagged task, returns an active candidate, and rejects draft start', async () => {
    const draft = await sr.create('requester')
    await expect(sr.startTask('staff', draft.id, { assistantId })).rejects.toMatchObject({ status: 409 })
    const submitted = await sr.submit('requester', draft.id, { title: '알람', titleSource: 'ai', body: '', attachmentIds: [] })
    const first = await sr.startTask('staff', draft.id, { assistantId })
    if ('candidates' in first) throw new Error('첫 연결 업무는 생성되어야 합니다')
    expect(first.tags).toContain(submitted.code)
    expect((await db.select().from(task).where(eq(task.id, first.id)))[0]?.status).toBe('in_progress')
    expect((await sr.get('requester', draft.id)).conversations).toEqual([])
    expect((await sr.get('staff', draft.id)).conversations).toMatchObject([{ id: first.id }])
    await expect(assertTaskAccess(db, 'requester', first.id)).rejects.toMatchObject({ status: 403 })
    expect(await assertThreadAccess(db, 'requester', draft.threadId)).toBeUndefined()
    await expect(assertThreadAccess(db, 'requester', first.threadId!)).rejects.toMatchObject({ status: 403 })
    expect(await sr.startTask('staff', draft.id, { assistantId })).toMatchObject({ candidates: [expect.objectContaining({ id: first.id })] })
  })

  it('does not grant SR access through a forged tag on an ordinary task', async () => {
    const draft = await sr.create('requester')
    const submitted = await sr.submit('requester', draft.id, { title: '비공개', body: '', attachmentIds: [] })
    const forged = await new DbTasksService(db).create('other', { assistantId, tags: [submitted.code] })
    expect(forged.task.tags).toContain(submitted.code)
    await expect(assertSrAccess(db, 'other', draft.id)).rejects.toMatchObject({ status: 403 })
    await expect(new DbTasksService(db).messages(draft.threadId, 'other')).rejects.toMatchObject({ status: 403 })
    await expect(sr.status('other', draft.id, 'reviewing')).rejects.toMatchObject({ status: 403 })
    await expect(sr.share('other', draft.id, { text: '위조' })).rejects.toMatchObject({ status: 403 })
    const staffForgery = await new DbTasksService(db).create('staff', { assistantId, tags: [submitted.code] })
    expect(staffForgery.task.tags).toContain(submitted.code)
    await expect(assertSrAccess(db, 'staff', draft.id)).rejects.toMatchObject({ status: 403 })
    await expect(sr.status('staff', draft.id, 'reviewing')).rejects.toMatchObject({ status: 403 })
    await expect(sr.share('staff', draft.id, { text: '위조' })).rejects.toMatchObject({ status: 403 })
  })

  it('filters another requester SR events on live delivery and replay', async () => {
    const draft = await sr.create('requester')
    const events = new EventsService(), controller = new EventsController(events, db)
    const open = async (lastId: string, actor = 'other') => {
      const stream = new EventEmitter() as EventEmitter & { status: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>;
        flushHeaders: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
      stream.status = vi.fn(() => stream); stream.set = vi.fn(() => stream); stream.flushHeaders = vi.fn()
      stream.write = vi.fn(() => true); stream.end = vi.fn()
      await controller.stream({ user: { id: actor } } as never, stream as unknown as Response, lastId)
      return stream
    }
    const cursor = events.cursor()
    const live = await open(cursor)
    events.publish('request.updated', { requestId: 'secret', threadId: draft.threadId, taskId: null, status: 'pending' })
    await vi.waitFor(() => expect(live.write.mock.calls.flat().join('')).not.toContain('secret'))
    events.publish('task.updated', { taskId: 'ordinary' })
    await vi.waitFor(() => expect(live.write.mock.calls.flat().join('')).toContain('ordinary'))
    expect(live.write.mock.calls.flat().join('')).not.toContain('secret')
    live.emit('close')
    const replay = await open(cursor)
    expect(replay.write.mock.calls.flat().join('')).not.toContain('secret')
    expect(replay.write.mock.calls.flat().join('')).toContain('ordinary')
    replay.emit('close')
    const requester = await open(cursor, 'requester')
    expect(requester.write.mock.calls.flat().join('')).toContain('secret')
    requester.emit('close')
  })

  it('notifies requester for status and result; rejects draft and empty share', async () => {
    const draft = await sr.create('requester')
    await expect(sr.share('owner', draft.id, { text: 'x', fileIds: [] })).rejects.toMatchObject({ status: 409 })
    await sr.submit('requester', draft.id, { title: '결과', titleSource: 'ai', body: '', attachmentIds: [] })
    await sr.startTask('staff', draft.id, { assistantId })
    await expect(sr.status('requester', draft.id, 'in_progress')).rejects.toMatchObject({ status: 403 })
    await sr.status('staff', draft.id, 'in_progress')
    const before = (await db.select().from(notification).where(eq(notification.userId, 'requester'))).length
    await expect(sr.share('staff', draft.id, { text: ' ', fileIds: [] })).rejects.toMatchObject({ status: 400 })
    const result = await sr.share('staff', draft.id, { text: '완료', fileIds: [] })
    expect((await db.select().from(sharedResult).where(eq(sharedResult.id, result.id)))).toHaveLength(1)
    expect((await db.select().from(serviceRequest).where(eq(serviceRequest.id, draft.id)))[0]?.status).toBe('responded')
    expect(await db.select({ type: activityLog.type, payload: activityLog.payload }).from(activityLog).where(eq(activityLog.srId, draft.id)))
      .toContainEqual({ type: 'sr.status_changed', payload: { from: 'in_progress', to: 'responded' } })
    expect((await db.select().from(notification).where(eq(notification.userId, 'requester')))).toHaveLength(before + 1)
  })

  it('binds SR attachments to their message and restricts the intake thread', async () => {
    const draft = await sr.create('requester')
    const fileId = 'sr-file-for-thread-test'
    await db.insert(fileObject).values({ id: fileId, kind: 'sr_attachment', originSrId: draft.id, originalName: 'alarm.txt',
      mime: 'text/plain', sizeBytes: 1, sha256: 'a'.repeat(64), storageKey: fileId, source: 'upload', version: 1, uploadedBy: 'requester' })
    const tasks = new DbTasksService(db)
    await tasks.appendMessage('requester', draft.threadId, { content: '알람 요청', kind: 'discussion', attachmentIds: [fileId] })
    expect((await tasks.messages(draft.threadId, 'requester'))[0]?.attachmentIds).toEqual([fileId])
    expect((await sr.get('requester', draft.id)).attachmentIds).toEqual([fileId])
    await expect(tasks.messages(draft.threadId, 'other')).rejects.toMatchObject({ status: 403 })
    await sr.submit('requester', draft.id, { title: '알람', body: '', attachmentIds: [] })
    await sr.startTask('staff', draft.id, { assistantId })
    expect(await tasks.messages(draft.threadId, 'staff')).toHaveLength(1)
    await assertFileAccess(db, 'requester', fileId)
    await expect(assertFileAccess(db, 'other', fileId)).rejects.toMatchObject({ status: 403 })
  })

  it('lets the requester open only explicitly shared task output files', async () => {
    const draft = await sr.create('requester')
    await sr.submit('requester', draft.id, { title: '결과', titleSource: 'manual', body: '', attachmentIds: [] })
    const linked = await sr.startTask('staff', draft.id, { assistantId })
    if ('candidates' in linked) throw new Error('첫 연결 업무는 생성되어야 합니다')
    for (const name of ['public', 'private']) await db.insert(fileObject).values({ id: `sr-${name}-${draft.id}`, kind: 'task_file', originTaskId: linked.id,
      originalName: `${name}.md`, mime: 'text/markdown', sizeBytes: 1, sha256: 'b'.repeat(64), storageKey: `sr-${name}-${draft.id}`,
      source: 'assistant', isOutput: true, version: 1, uploadedBy: 'staff' })
    const publicId = `sr-public-${draft.id}`, privateId = `sr-private-${draft.id}`
    await expect(assertFileAccess(db, 'requester', publicId)).rejects.toMatchObject({ status: 403 })
    await sr.share('staff', draft.id, { taskId: linked.id, text: '', fileIds: [publicId] })
    await assertFileAccess(db, 'requester', publicId)
    await expect(assertFileAccess(db, 'requester', privateId)).rejects.toMatchObject({ status: 403 })
  })

  it('denies a requester an active assistant image outside their SR', async () => {
    const fileId = 'sr-active-image'
    await db.insert(fileObject).values({ id: fileId, kind: 'assistant_image', originalName: 'image.png', mime: 'image/png',
      sizeBytes: 1, sha256: 'c'.repeat(64), storageKey: fileId, source: 'upload', version: 1, uploadedBy: 'staff' })
    await db.update(assistant).set({ imageFileId: fileId, status: 'open' }).where(eq(assistant.id, assistantId))
    await expect(assertFileAccess(db, 'other', fileId)).rejects.toMatchObject({ status: 403 })
    await db.update(assistant).set({ imageFileId: null }).where(eq(assistant.id, assistantId))
    await expect(assertFileAccess(db, 'other', fileId)).rejects.toMatchObject({ status: 403 })
  })

  it.each(['done', 'rejected'] as const)('preserves %s when sharing another result', async (closed) => {
    const draft = await sr.create('requester')
    await sr.submit('requester', draft.id, { title: '종료', body: '', attachmentIds: [] })
    await sr.startTask('staff', draft.id, { assistantId })
    await sr.status('staff', draft.id, closed)
    await sr.share('staff', draft.id, { text: '추가 결과' })
    expect((await sr.get('requester', draft.id)).status).toBe(closed)
  })

  it('stores selected attachment IDs on the intake thread and reflects content edits', async () => {
    const draft = await sr.create('requester')
    for (const fileId of ['selected-a', 'selected-b', 'unselected']) await db.insert(fileObject).values({ id: `${fileId}-${draft.id}`,
      kind: 'sr_attachment', originSrId: draft.id, originalName: `${fileId}.txt`, mime: 'text/plain', sizeBytes: 1,
      sha256: 'd'.repeat(64), storageKey: `${fileId}-${draft.id}`, source: 'upload', version: 1, uploadedBy: 'requester' })
    expect((await sr.get('requester', draft.id)).attachmentIds).toEqual([])
    expect((await sr.submit('requester', draft.id, { title: '첨부', body: '첫 본문', attachmentIds: [`selected-a-${draft.id}`] })).attachmentIds)
      .toEqual([`selected-a-${draft.id}`])
    expect((await sr.content('requester', draft.id, { title: '첨부', body: '수정 본문', attachmentIds: [`selected-b-${draft.id}`] })).attachmentIds)
      .toEqual([`selected-b-${draft.id}`])
  })
  it('forces BO mine even for inbox; staff mine filters requester and inbox excludes drafts', async () => {
    await db.insert(appUser).values([
      { id: 'scope-bo', name: 'BO', initials: 'B', color: '#123456', isBusinessOwner: true },
      { id: 'scope-staff', name: 'Staff', initials: 'S', color: '#123456' },
    ])
    const before = (await sr.list('owner', 'inbox')).map(row => row.id)
    const mine = await sr.create('scope-bo')
    const staffDraft = await sr.create('scope-staff')
    const other = await sr.create('other')
    await sr.submit('other', other.id, { title: '다른 요청', body: '' })
    expect((await sr.list('scope-bo', 'inbox')).map(row => row.id)).toEqual([mine.id])
    expect((await sr.list('scope-staff', 'mine')).map(row => row.id)).toEqual([staffDraft.id])
    expect((await sr.list('owner', 'inbox')).map(row => row.id)).toEqual([other.id, ...before])
    expect((await sr.list('owner', 'mine')).map(row => row.id)).toEqual([])
    await sr.delete('scope-bo', mine.id)
    await sr.delete('scope-staff', staffDraft.id)
  })

  it('serializes repeated first-send creation and separates keys by actor', async () => {
    const [first, retry] = await Promise.all([sr.create('requester', 'same-first-send'), sr.create('requester', 'same-first-send')])
    expect(retry.id).toBe(first.id)
    expect(retry.threadId).toBe(first.threadId)
    expect((await sr.list('requester', 'mine')).filter(row => row.id === first.id)).toHaveLength(1)
    expect(await db.select().from(dbLock).where(eq(dbLock.lockKey, `sr-create:${first.id}`))).toEqual([])
    const another = await sr.create('other', 'same-first-send')
    expect(another.id).not.toBe(first.id)
    await sr.delete('requester', first.id)
    await sr.delete('other', another.id)
  })


  it('allows inbox staff to read the intake transcript through SR detail without granting chat mutation access', async () => {
    const draft = await sr.create('requester')
    await new DbTasksService(db).appendMessage('requester', draft.threadId, { content: '접수 원문', kind: 'discussion' })
    // 초안 원문은 요청자 본인·SO만 — 접수 전 상담 내용은 담당자에게 보이지 않는다.
    expect((await sr.get('staff', draft.id)).intakeMessages).toEqual([])
    expect((await sr.get('requester', draft.id)).intakeMessages).toMatchObject([{ content: '접수 원문' }])
    expect((await sr.get('owner', draft.id)).intakeMessages).toMatchObject([{ content: '접수 원문' }])
    await sr.submit('requester', draft.id, { title: '원문', body: '' })
    expect((await sr.get('staff', draft.id)).intakeMessages).toMatchObject([{ content: '접수 원문' }])
    await expect(assertThreadAccess(db, 'staff', draft.threadId)).rejects.toMatchObject({ status: 403 })
    await expect(sr.get('other', draft.id)).rejects.toMatchObject({ status: 403 })
  })

  it('returns intake display metadata and attachment limit without exposing the staff catalog', async () => {
    await db.insert(appSetting).values({ key: 'fileMaxPerRequest', value: 3 }).onDuplicateKeyUpdate({ set: { value: 3 } })
    const [intake] = await db.select().from(assistant).where(eq(assistant.id, assistantId))
    expect(await sr.intakeAssistant()).toEqual({ srIntakeAssistantId: assistantId, name: intake!.name, summary: intake!.summary, usageExample: intake!.usageExample, fileMaxPerRequest: 3 })
    await db.delete(appSetting).where(eq(appSetting.key, 'fileMaxPerRequest'))
  })

  it('serves file metadata to the requester over HTTP with the same scope as download, without widening other file routes', async () => {
    const draft = await sr.create('requester')
    const foreign = await sr.create('other')
    type FileInsert = typeof fileObject.$inferInsert
    const file = (id: string, extra: Pick<FileInsert, 'kind' | 'uploadedBy'> & Partial<FileInsert>) => ({ id, originalName: `${id}.txt`, mime: 'text/plain', sizeBytes: 1,
      sha256: 'd'.repeat(64), storageKey: id, source: 'upload' as const, version: 1, ...extra })
    await db.insert(fileObject).values([
      file('http-own-attachment', { kind: 'sr_attachment', originSrId: draft.id, uploadedBy: 'requester' }),
      file('http-foreign-attachment', { kind: 'sr_attachment', originSrId: foreign.id, uploadedBy: 'other' }),
    ])
    await sr.submit('requester', draft.id, { title: '메타', titleSource: 'manual', body: '', attachmentIds: ['http-own-attachment'] })
    const linked = await sr.startTask('staff', draft.id, { assistantId })
    if ('candidates' in linked) throw new Error('첫 연결 업무는 생성되어야 합니다')
    await db.insert(fileObject).values([
      file('http-shared-output', { kind: 'task_file', originTaskId: linked.id, source: 'assistant', isOutput: true, uploadedBy: 'staff' }),
      file('http-internal-output', { kind: 'task_file', originTaskId: linked.id, source: 'assistant', isOutput: true, uploadedBy: 'staff' }),
    ])
    await sr.share('staff', draft.id, { taskId: linked.id, text: '', fileIds: ['http-shared-output'] })

    const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' })
    const apiClient = createPool(temp.url, 2)
    const users: Record<string, AuthUser> = {
      requester: { id: 'requester', name: 'Requester', role: '', theme: 'system', locale: 'ko', isSystemOwner: false, isBusinessOwner: true },
      staff: { id: 'staff', name: 'Staff', role: '', theme: 'system', locale: 'ko', isSystemOwner: false },
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(DB_CLIENT).useValue(apiClient)
      .overrideProvider(DB).useValue(drizzle(apiClient))
      .overrideProvider(SESSION_STORE).useValue({ resolve: async (token: string) => users[token] ?? null })
      .compile()
    const app = configureApp(moduleRef.createNestApplication(), config)
    try {
      await app.init()
      const get = (actor: keyof typeof users, path: string) => request(app.getHttpServer()).get(path).set('Cookie', `mes_session=${actor}`)
      const own = await get('requester', '/api/files/http-own-attachment').expect(200)
      expect(own.body).toMatchObject({ id: 'http-own-attachment', name: 'http-own-attachment.txt', originSrId: draft.id })
      const shared = await get('requester', '/api/files/http-shared-output').expect(200)
      expect(shared.body).toMatchObject({ id: 'http-shared-output', name: 'http-shared-output.txt' })
      await get('requester', '/api/files/http-foreign-attachment').expect(403)
      await get('requester', '/api/files/http-internal-output').expect(403)
      await get('requester', '/api/files/http-own-attachment/versions').expect(403)
      await request(app.getHttpServer()).patch('/api/files/http-own-attachment').set('Cookie', 'mes_session=requester').send({ isOutput: true }).expect(403)
      await get('staff', '/api/files/http-internal-output').expect(200)
    } finally {
      await app.close()
    }
  })

})
