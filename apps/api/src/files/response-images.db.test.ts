import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/mysql2'
import type { Pool } from 'mysql2/promise'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider, type ChatProvider } from '@mes/llm'
import { createPool } from '../db/connection.js'
import type { Db } from '../db/db.module.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { appUser, assistant, fileObject, serviceRequest, message, messageAttachment } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { createTempDb } from '../test/tempDb.js'
import { DbTasksService } from '../tasks/tasks.service.js'
import { TaskExtrasService } from '../tasks/task-extras.service.js'
import { SrService } from '../sr/sr.service.js'
import { EventsService } from '../events/events.service.js'
import { FileStorageService } from './fileStorage.service.js'
import { DbFilesService } from './files.service.js'
import { RequestsService } from '../requests/requests.service.js'
import { loadConfig } from '../config/config.js'

let temp: Awaited<ReturnType<typeof createTempDb>>, client: Pool, db: Db, root: string
let files: DbFilesService, tasks: DbTasksService, sr: SrService, assistantId: string
beforeAll(async () => {
  temp = await createTempDb('response_images')
  await runMigrations(temp.url)
  client = createPool(temp.url)
  db = drizzle(client)
  await seedCatalog(db)
  await db.insert(appUser).values({ id: 'image-member', name: 'Member', initials: 'M', color: '#123456', isSystemOwner: true })
  assistantId = (await db.select().from(assistant))[0]!.id
  root = await mkdtemp(join(tmpdir(), 'mes-response-images-'))
  files = new DbFilesService(db, new FileStorageService(root), { fileMaxBytes: 1024, fileMaxPerRequest: 5 })
  tasks = new DbTasksService(db)
  sr = new SrService(db, tasks, new EventsService())
})
afterAll(async () => { await client?.end(); await temp?.drop(); if (root) await rm(root, { recursive: true, force: true }) })

async function linkedImage() {
  const draft = await sr.create('image-member')
  const submitted = await sr.submit('image-member', draft.id, { title: 'image SR', body: 'body' })
  const created = await tasks.create('image-member', { assistantId, tags: [submitted.code!] })
  const imageId = randomUUID()
  const storageKey = `test/${imageId}.png`
  await new FileStorageService(root).write(storageKey, new Uint8Array([1, 2, 3]))
  await db.insert(fileObject).values({ id: imageId, kind: 'ai_output', originSrId: draft.id, originalName: 'image.png',
    mime: 'image/png', sizeBytes: 3, sha256: 'a'.repeat(64), storageKey, source: 'assistant', version: 1, uploadedBy: 'image-member' })
  return { srId: draft.id, code: submitted.code!, taskId: created.task.id, imageId }
}

it('selected SR ai_output stays in srFiles and never enters task version chains', async () => {
  const { taskId, imageId } = await linkedImage()
  await files.setInput('image-member', taskId, imageId, 'main')
  const candidates = await files.candidates(taskId, 'image-member')
  expect(candidates.files.map(item => item.file.id)).not.toContain(imageId)
  expect(candidates.srFiles).toEqual([expect.objectContaining({ file: expect.objectContaining({ id: imageId }), selected: 'main' })])
})

it('removing an SR tag removes its generated image from the next request selection', async () => {
  const { taskId, imageId, code } = await linkedImage()
  await files.setInput('image-member', taskId, imageId, 'reference')
  await tasks.removeTag('image-member', taskId, code)
  expect((await tasks.get(taskId)).inputs).toEqual([])
  expect((await files.candidates(taskId)).srFiles).toEqual([])
})

it('an SR requester BO reads generated images from a system owner but other BOs cannot', async () => {
  const { srId, imageId } = await linkedImage()
  const bo = randomUUID(), stranger = randomUUID()
  await db.insert(appUser).values([bo, stranger].map(id => ({ id, name: 'BO', initials: 'B', color: '#123456', isBusinessOwner: true })))
  await db.update(serviceRequest).set({ requesterId: bo }).where(eq(serviceRequest.id, srId))
  expect(await files.content(imageId, bo)).toEqual(new Uint8Array([1, 2, 3]))
  await expect(files.content(imageId, stranger)).rejects.toMatchObject({ status: 403 })
})

it('accepts a visible generated image as a note attachment and still rejects deleted files', async () => {
  const { taskId, imageId } = await linkedImage()
  const extras = new TaskExtrasService(db, {} as never, {} as never, new FileStorageService(root), new EventsService())
  const note = await extras.addNote('image-member', taskId, 'image note', [imageId, imageId])
  expect(note.attachmentIds).toEqual([imageId])
  expect((await extras.notes('image-member', taskId))[0]?.attachmentIds).toEqual([imageId])
  await db.update(fileObject).set({ deletedAt: new Date() }).where(eq(fileObject.id, imageId))
  await expect(extras.addNote('image-member', taskId, 'deleted image', [imageId])).rejects.toMatchObject({ status: 400 })
})

const imageProvider: ChatProvider = {
  kind: 'mock', ping: async () => ({ ok: true, detail: '' }), listModels: async () => ['model'],
  async *stream() {
    yield { type: 'delta', text: '![image](/cache/generated.png)' }
    yield { type: 'images', images: [{ sources: ['/cache/generated.png'], name: 'generated.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }], failures: [] }
    yield { type: 'done' }
  },
}
function runner(provider = imageProvider, events = new EventsService(), overrides: Record<string, string> = {}) {
  return new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 'x'.repeat(32),
    APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root, ...overrides }), provider, events)
}

it('publishes sr.updated after SR image registration so an open library refreshes', async () => {
  const draft = await sr.create('image-member')
  const events = new EventsService(), publish = vi.spyOn(events, 'publish')
  const request = runner(imageProvider, events)
  try {
    const started = await request.start('image-member', draft.threadId, { content: 'draw' }, randomUUID())
    await started.done
    expect(await request.get(started.id)).toMatchObject({ status: 'succeeded' })
    expect(await db.select().from(fileObject).where(eq(fileObject.originSrId, draft.id))).toHaveLength(1)
    expect(publish.mock.calls).toContainEqual(['sr.updated', { srId: draft.id }])
  } finally { request.onModuleDestroy() }
})

it('rolls back failed image registration, preserves the original body and removes prepared bytes', async () => {
  const created = await tasks.create('image-member', { assistantId })
  await client.query("create trigger reject_response_image before insert on file_object for each row begin if NEW.kind = 'ai_output' then signal sqlstate '45000' set message_text = 'test image registration failure'; end if; end")
  const write = vi.spyOn(FileStorageService.prototype, 'write')
  const request = runner()
  try {
    const started = await request.start('image-member', created.thread.id, { content: 'draw' }, randomUUID())
    await started.done
    expect(await request.get(started.id)).toMatchObject({ status: 'succeeded' })
    const [reply] = await db.select().from(message).where(eq(message.id, started.replyMessageId))
    expect(reply).toMatchObject({ content: '![image](/cache/generated.png)', originalContent: null })
    expect(await db.select().from(fileObject).where(eq(fileObject.originTaskId, created.task.id))).toEqual([])
    expect(await db.select().from(messageAttachment).where(eq(messageAttachment.messageId, started.replyMessageId))).toEqual([])
    expect(await request.snapshot(started.id)).toMatchObject({ responseImages: { saved: [], failures: [{ source: '/cache/generated.png', reason: '이미지 등록 실패' }] } })
    const imageKeys = write.mock.calls.map(([key]) => key).filter(key => key.endsWith('.png'))
    expect(imageKeys).toHaveLength(1)
    for (const key of imageKeys) expect(await new FileStorageService(root).exists(key)).toBe(false)
  } finally { write.mockRestore(); request.onModuleDestroy(); await client.query('drop trigger reject_response_image') }
})

it('does not duplicate files or bytes on same-key request replay and retry replay', async () => {
  let calls = 0
  const request = runner({ ...imageProvider, async *stream() {
    if (++calls === 1) { yield { type: 'error', message: 'retry me' }; return }
    yield* imageProvider.stream({ model: 'model', messages: [] })
  } })
  const created = await tasks.create('image-member', { assistantId })
  const key = randomUUID(), retryKey = randomUUID()
  const write = vi.spyOn(FileStorageService.prototype, 'write')
  try {
    const first = await request.start('image-member', created.thread.id, { content: 'draw' }, key)
    await first.done
    expect((await request.start('image-member', created.thread.id, { content: 'draw' }, key)).id).toBe(first.id)
    const second = await request.retry('image-member', first.id, {}, retryKey)
    await second.done
    expect((await request.retry('image-member', first.id, {}, retryKey)).id).toBe(second.id)
    expect(calls).toBe(2)
    const rows = await db.select().from(fileObject).where(eq(fileObject.originTaskId, created.task.id))
    expect(rows).toHaveLength(1)
    expect(await db.select().from(messageAttachment).where(eq(messageAttachment.messageId, second.replyMessageId))).toHaveLength(1)
    expect(write.mock.calls.filter(([key]) => key.endsWith('.png'))).toHaveLength(1)
    expect(await new FileStorageService(root).read(rows[0]!.storageKey)).toEqual(new Uint8Array([1, 2, 3]))
  } finally { write.mockRestore(); request.onModuleDestroy() }
})

it('preserves downloaded images and timeout reasons in the failed request snapshot', async () => {
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith('/api/models')) return Response.json({ data: [] })
    if (String(url).endsWith('/api/config')) return Response.json({})
    if (String(url).endsWith('/api/v1/terminals/')) return Response.json([])
    if (String(url).endsWith('/chat/completions')) return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '![a](/cache/a.png) ![b](/cache/b.png) ![c](/cache/c.png)' } }] })}\n\ndata: [DONE]\n\n`)
    if (String(url).endsWith('/a.png')) return new Response('image', { headers: { 'content-type': 'image/png' } })
    return await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
  })
  const provider = new OpenAICompatibleProvider({ mode: 'live', preset: 'openwebui', baseUrl: 'https://owui.test/api', apiKey: 'test', model: 'model' })
  const request = runner(provider, new EventsService(), { LLM_OWUI_MODE: 'direct', REQUEST_IDLE_MS: '2000', REQUEST_MAX_MS: '10000' })
  const created = await tasks.create('image-member', { assistantId })
  try {
    const started = await request.start('image-member', created.thread.id, { content: 'draw' }, randomUUID())
    await started.done
    expect(await request.get(started.id)).toMatchObject({ status: 'failed', code: 'TIMEOUT' })
    const rows = await db.select().from(fileObject).where(eq(fileObject.originTaskId, created.task.id))
    expect(rows).toHaveLength(1)
    expect(await request.snapshot(started.id)).toMatchObject({ responseImages: { saved: [{ fileId: rows[0]!.id }], failures: [
      { source: '/cache/b.png', reason: '이미지 다운로드 시간 초과' }, { source: '/cache/c.png', reason: '이미지 다운로드 시간 초과' },
    ] } })
    const [reply] = await db.select().from(message).where(eq(message.id, started.replyMessageId))
    expect(reply?.content).toContain(`/api/files/${rows[0]!.id}/content`)
    expect(reply?.originalContent).toContain('/cache/a.png')
  } finally { vi.unstubAllGlobals(); request.onModuleDestroy() }
})

it('cancellation fences late image registration and leaves no orphaned image bytes', async () => {
  let ready!: () => void, release!: () => void
  const streaming = new Promise<void>(resolve => { ready = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const request = runner({ ...imageProvider, async *stream() {
    yield { type: 'delta', text: '![i](/cache/generated.png)' }
    yield { type: 'images', images: [{ sources: ['/cache/generated.png'], name: 'generated.png', mime: 'image/png', bytes: new Uint8Array([1]) }], failures: [] }
    ready(); await gate; yield { type: 'done' }
  } })
  const created = await tasks.create('image-member', { assistantId })
  const write = vi.spyOn(FileStorageService.prototype, 'write')
  try {
    const started = await request.start('image-member', created.thread.id, { content: 'draw' }, randomUUID())
    await streaming
    await request.cancel(started.id, 'image-member')
    release(); await started.done
    expect(await request.get(started.id)).toMatchObject({ status: 'cancelled' })
    expect(await db.select().from(fileObject).where(eq(fileObject.originTaskId, created.task.id))).toEqual([])
    expect(write.mock.calls.filter(([key]) => key.endsWith('.png'))).toEqual([])
  } finally { release(); write.mockRestore(); request.onModuleDestroy() }
})
