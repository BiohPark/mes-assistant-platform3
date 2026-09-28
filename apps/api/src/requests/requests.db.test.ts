import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider, type ChatProvider } from '@mes/llm'
import { loadConfig } from '../config/config.js'
import { runMigrations } from '../db/migrate.js'
import { chatRequest, fileObject, message, task, taskInput } from '../db/schema.js'
import { seedCatalog } from '../db/seed.js'
import { appUser, assistant } from '../db/schema.js'
import { createTempDb } from '../test/tempDb.js'
import { DbTasksService } from '../tasks/tasks.service.js'
import { RequestsService } from './requests.service.js'
import { FileStorageService } from '../files/fileStorage.service.js'
import { DbLlmPorts } from '../llm/dbLlmPorts.js'
import { toLlmSettings } from '../llm/presets.js'

describe('RequestService DB', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let root: string
  let client: postgres.Sql
  let db: ReturnType<typeof drizzle>
  let tasks: DbTasksService
  let service: RequestsService
  let assistantId: string
  const provider: ChatProvider = {
    kind: 'mock', ping: async () => ({ ok: true, detail: '' }), listModels: async () => ['glm-5.2'],
    async *stream() { yield { type: 'delta', text: '응답' }; yield { type: 'done' } },
  }
  beforeAll(async () => {
    temp = await createTempDb('requests')
    root = await mkdtemp(join(tmpdir(), 'mes-request-'))
    await runMigrations(temp.url)
    client = postgres(temp.url)
    db = drizzle(client)
    await seedCatalog(db)
    await db.insert(appUser).values({ id: 'member', name: 'Member', initials: 'M', color: '#123456' })
    assistantId = (await db.select().from(assistant))[0]!.id
    tasks = new DbTasksService(db)
    service = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), provider)
  })
  afterAll(async () => { service?.onModuleDestroy(); await client?.end(); await temp?.drop(); await rm(root, { recursive: true, force: true }) })

  it('stores one user, reply and structured request without keys', async () => {
    const { thread } = await tasks.create('member', { assistantId })
    const started = await service.start('member', thread.id, { content: '안녕' }, 'key-one')
    await started.done
    const record = await service.get(started.id)
    expect(record).toMatchObject({ status: 'succeeded', bytes: expect.any(Number), inputs: [] })
    expect((await tasks.messages(thread.id)).map((item) => [item.role, item.status])).toEqual([['user', 'done'], ['assistant', 'done']])
    expect(JSON.stringify(await service.snapshot(started.id))).not.toMatch(/apiKey|remoteId/)
    expect((await db.select().from(chatRequest).where(eq(chatRequest.id, started.id)))[0]?.replyMessageId).toBe(started.replyMessageId)
  })

  it('hides a conversation with request history while preserving its audit rows', async () => {
    const created = await tasks.create('member', { assistantId })
    const run = await service.start('member', created.thread.id, { content: '보존' }, 'delete-history')
    await run.done
    await tasks.delete(created.task.id)
    expect((await db.select().from(task).where(eq(task.id, created.task.id)))[0]?.deletedAt).toBeTruthy()
    await expect(tasks.get(created.task.id)).rejects.toMatchObject({ status: 404 })
    expect((await service.get(run.id)).status).toBe('succeeded')
  })

  it('moves a request snapshot above 1 MiB to file storage', async () => {
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173',
      FILE_STORAGE_ROOT: root, REQUEST_BUDGET_BYTES: String(2 * 1024 * 1024) }), provider)
    const { thread } = await tasks.create('member', { assistantId })
    const run = await runner.start('member', thread.id, { content: 'x'.repeat(1_100_000) }, 'large-snapshot')
    await run.done
    const [row] = await db.select({ snapshot: chatRequest.snapshot }).from(chatRequest).where(eq(chatRequest.id, run.id))
    expect(row?.snapshot).toMatchObject({ storageKey: expect.stringMatching(/^requests\//) })
    const snapshot = await runner.snapshot(run.id) as { messages: Array<{ content: string }> }
    expect(snapshot.messages.at(-1)?.content.length).toBe(1_100_000)
  })

  it('deduplicates the same key and rejects concurrent different keys', async () => {
    const { thread } = await tasks.create('member', { assistantId })
    const a = await service.start('member', thread.id, { content: '첫 요청' }, 'same-key')
    const duplicate = await service.start('member', thread.id, { content: '첫 요청' }, 'same-key')
    expect(duplicate.id).toBe(a.id)
    const result = await Promise.allSettled([service.start('member', thread.id, { content: '둘' }, 'other-one'), service.start('member', thread.id, { content: '셋' }, 'other-two')])
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(0)
    expect(result.every((item) => item.status === 'rejected' && item.reason.status === 409)).toBe(true)
    await a.done
  })

  it('allows exactly one of two simultaneous starts', async () => {
    const { thread } = await tasks.create('member', { assistantId })
    const result = await Promise.allSettled([
      service.start('member', thread.id, { content: '하나' }, 'race-a'),
      service.start('member', thread.id, { content: '둘' }, 'race-b'),
    ])
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(result.filter((item) => item.status === 'rejected' && item.reason.status === 409)).toHaveLength(1)
    for (const item of result) if (item.status === 'fulfilled') await item.value.done
  })

  it('keeps the active slot until the reply is stored, then releases it', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slow: ChatProvider = { ...provider, async *stream() { await gate; yield { type: 'delta', text: '완료' } } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), slow)
    const { thread } = await tasks.create('member', { assistantId })
    const first = await runner.start('member', thread.id, { content: '첫 요청' }, 'slot-first')
    await expect(runner.start('member', thread.id, { content: '조기 요청' }, 'slot-early')).rejects.toMatchObject({ status: 409 })
    release()
    await first.done
    const second = await runner.start('member', thread.id, { content: '다음 요청' }, 'slot-second')
    await second.done
    expect((await runner.get(second.id)).status).toBe('succeeded')
  })

  it('cancels a request and preserves flushed partial text', async () => {
    const slow: ChatProvider = { ...provider, async *stream() { yield { type: 'delta', text: '부분' }; await new Promise((resolve) => setTimeout(resolve, 100)); yield { type: 'delta', text: '늦은 글' } } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root, REQUEST_FLUSH_MS: '1' }), slow)
    const { thread } = await tasks.create('member', { assistantId })
    const run = await runner.start('member', thread.id, { content: '중지' }, 'cancel-key')
    await new Promise<void>((resolve) => { const off = runner.subscribe(run.id, (event) => { if (event.event === 'delta') { off(); resolve() } }) })
    await new Promise((resolve) => setTimeout(resolve, 30))
    await runner.cancel(run.id)
    await run.done
    const [reply] = await db.select().from(message).where(eq(message.id, run.replyMessageId))
    expect(reply).toMatchObject({ status: 'error', content: '부분' })
    expect(await runner.get(run.id)).toMatchObject({ status: 'cancelled', code: 'CANCELLED' })
    runner.onModuleDestroy()
  })

  it('only sweeps expired leases', async () => {
    const { thread } = await tasks.create('member', { assistantId })
    const run = await service.start('member', thread.id, { content: '정리' }, 'sweep-key')
    await run.done
    await db.update(chatRequest).set({ status: 'streaming', leaseUntil: new Date(Date.now() - 1000) }).where(eq(chatRequest.id, run.id))
    await db.update(message).set({ status: 'streaming' }).where(eq(message.id, run.replyMessageId))
    expect(await service.sweep()).toBe(1)
    expect(await service.get(run.id)).toMatchObject({ status: 'interrupted', code: 'INTERRUPTED' })
    expect(await service.sweep()).toBe(0)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slow: ChatProvider = { ...provider, async *stream() { await gate; yield { type: 'delta', text: '정상' } } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), slow)
    const next = await tasks.create('member', { assistantId })
    const live = await runner.start('member', next.thread.id, { content: '생존' }, 'live-sweep')
    expect(await runner.sweep()).toBe(0)
    release()
    await live.done
  })

  it('does not sweep a lease renewed after the expired list was read', async () => {
    const { thread } = await tasks.create('member', { assistantId })
    const run = await service.start('member', thread.id, { content: '경쟁' }, 'renewed-lease')
    await run.done
    await db.update(chatRequest).set({ status: 'streaming', leaseUntil: new Date(Date.now() - 1000) }).where(eq(chatRequest.id, run.id))
    await db.update(message).set({ status: 'streaming' }).where(eq(message.id, run.replyMessageId))
    const original = (service as never as { transition: (...args: unknown[]) => Promise<boolean> }).transition.bind(service)
    const spy = vi.spyOn(service as never as { transition: (...args: unknown[]) => Promise<boolean> }, 'transition').mockImplementation(async (...args) => {
      await db.update(chatRequest).set({ leaseUntil: new Date(Date.now() + 30_000) }).where(eq(chatRequest.id, run.id))
      return original(...args)
    })
    try { expect(await service.sweep()).toBe(0); expect((await service.get(run.id)).status).toBe('streaming') }
    finally { spy.mockRestore() }
    await db.update(chatRequest).set({ status: 'succeeded' }).where(eq(chatRequest.id, run.id))
    await db.update(message).set({ status: 'done' }).where(eq(message.id, run.replyMessageId))
  })

  it('aborts the runner when lease renewal updates no active row', async () => {
    let reason: unknown
    const waiting: ChatProvider = { ...provider, async *stream(request) {
      await new Promise<void>((resolve) => {
        if (request.signal?.aborted) resolve()
        else request.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      reason = request.signal?.reason
      yield { type: 'done' }
    } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root,
      REQUEST_KEEPALIVE_MS: '5' }), waiting)
    const { thread } = await tasks.create('member', { assistantId })
    const run = await runner.start('member', thread.id, { content: 'lease' }, 'lost-lease')
    for (let i = 0; i < 100 && (await runner.get(run.id)).status !== 'streaming'; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    await db.update(chatRequest).set({ status: 'interrupted' }).where(eq(chatRequest.id, run.id))
    await run.done
    expect(reason).toBe('lost')
  })

  it('keeps built file inputs when a streaming request is cancelled', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slow: ChatProvider = { ...provider, async *stream() { await gate; yield { type: 'delta', text: '늦음' } } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), slow)
    const { task: owner, thread } = await tasks.create('member', { assistantId })
    const fileId = `built-${Date.now()}`
    await new FileStorageService(root).write(`test/${fileId}.txt`, Buffer.from('input'))
    await db.insert(fileObject).values({ id: fileId, kind: 'task_file', originTaskId: owner.id, originalName: 'input.txt', mime: 'text/plain', sizeBytes: 5,
      sha256: 'a'.repeat(64), storageKey: `test/${fileId}.txt`, source: 'upload', version: 1, uploadedBy: 'member' })
    await db.insert(taskInput).values({ taskId: owner.id, fileId, weight: 'main', sortOrder: 0, selectedBy: 'member' })
    const run = await runner.start('member', thread.id, { content: '입력 기록' }, 'built-input')
    for (let i = 0; i < 100 && (await runner.get(run.id)).status !== 'streaming'; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    await runner.cancel(run.id)
    release()
    await run.done
    expect(await runner.get(run.id)).toMatchObject({ status: 'cancelled', inputs: [{ fileId, bytes: expect.any(Number) }] })
  })

  it('bounds replay and resumes a long active stream from saved text', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const many: ChatProvider = { ...provider, async *stream() {
      for (let index = 0; index < 2100; index++) yield { type: 'delta', text: 'x' }
      await gate
      yield { type: 'delta', text: '끝' }
    } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root, REQUEST_FLUSH_MS: '1' }), many)
    const { thread } = await tasks.create('member', { assistantId })
    const run = await runner.start('member', thread.id, { content: '긴 답' }, 'long-replay')
    for (let i = 0; i < 100 && (await db.select().from(message).where(eq(message.id, run.replyMessageId)))[0]?.content.length !== 2100; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(((runner as never as { events: Map<string, unknown[]> }).events.get(run.id) ?? []).length).toBeLessThanOrEqual(2002)
    const same = await runner.start('member', thread.id, { content: '긴 답' }, 'long-replay')
    expect(same.id).toBe(run.id)
    const seen: Array<{ event: string; data: Record<string, unknown> }> = []
    const off = runner.subscribe(run.id, (event) => seen.push(event))
    expect(seen[0]).toMatchObject({ event: 'started', data: { resumedText: 'x'.repeat(2100) } })
    expect(seen.filter((event) => event.event === 'delta')).toHaveLength(0)
    release()
    await run.done
    expect(seen.filter((event) => event.event === 'delta').map((event) => event.data.text)).toEqual(['끝'])
    off()
  })

  it('uses the attachment deadline through a slow build', async () => {
    const original = DbLlmPorts.prototype.getAssistants
    let entered!: () => void
    const building = new Promise<void>((resolve) => { entered = resolve })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const spy = vi.spyOn(DbLlmPorts.prototype, 'getAssistants').mockImplementation(async function (this: DbLlmPorts) {
      entered()
      await gate
      return original.call(this)
    })
    const realSetTimeout = global.setTimeout
    const realClearTimeout = global.clearTimeout
    const epoch = Date.now()
    let clock = epoch
    const timers: Array<{ due: number; callback: () => void; active: boolean; token: object }> = []
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const timeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      if ((ms ?? 0) < 60_000) return realSetTimeout(callback, ms, ...args)
      const token = { unref: () => token }
      timers.push({ due: clock + ms!, callback: () => callback(...args), active: true, token })
      return token
    }) as typeof setTimeout)
    const clearSpy = vi.spyOn(global, 'clearTimeout').mockImplementation(((token: object) => {
      const timer = timers.find((item) => item.token === token)
      if (timer) timer.active = false
      else realClearTimeout(token as ReturnType<typeof setTimeout>)
    }) as typeof clearTimeout)
    try {
      const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root,
        REQUEST_FIRST_TOKEN_MS: '60000', REQUEST_FILES_FIRST_TOKEN_MS: '360000' }), provider)
      const { task: owner, thread } = await tasks.create('member', { assistantId })
      const fileId = `deadline-${Date.now()}`
      await new FileStorageService(root).write(`test/${fileId}.txt`, Buffer.from('file'))
      await db.insert(fileObject).values({ id: fileId, kind: 'task_file', originTaskId: owner.id, originalName: 'file.txt', mime: 'text/plain', sizeBytes: 4,
        sha256: 'a'.repeat(64), storageKey: `test/${fileId}.txt`, source: 'upload', version: 1, uploadedBy: 'member' })
      const run = await runner.start('member', thread.id, { content: '첨부', attachmentIds: [fileId] }, 'file-deadline')
      await building
      clock += 70_000
      for (const timer of timers) if (timer.active && timer.due <= clock) { timer.active = false; timer.callback() }
      release()
      await run.done
      expect((await runner.get(run.id)).status).toBe('succeeded')
    } finally { release(); clearSpy.mockRestore(); timeoutSpy.mockRestore(); nowSpy.mockRestore(); spy.mockRestore() }
  })

  it('holds the auxiliary slot until an aborted provider settles', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let aborted = false
    const first = service.runAuxiliary('aux-user', 'title', async (signal) => {
      signal.addEventListener('abort', () => { aborted = true }, { once: true })
      await gate
      return 'late'
    }, { timeoutMs: 5 })
    void first.catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(aborted).toBe(true)
    await expect(service.runAuxiliary('aux-user', 'summary', async () => 'early')).rejects.toMatchObject({ status: 429 })
    release()
    await expect(first).rejects.toThrow(/시간 초과/)
    expect(await service.runAuxiliary('aux-user', 'summary', async () => 'next')).toBe('next')
  })

  it('does not write a large snapshot when cancellation wins the transition', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slow: ChatProvider = { ...provider, async *stream() { await gate; yield { type: 'delta', text: 'late' } } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root,
      REQUEST_BUDGET_BYTES: String(2 * 1024 * 1024) }), slow)
    const { thread } = await tasks.create('member', { assistantId })
    const run = await runner.start('member', thread.id, { content: 'x'.repeat(1_100_000) }, 'cancel-snapshot')
    for (let i = 0; i < 100 && (await runner.get(run.id)).status !== 'streaming'; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    await runner.cancel(run.id)
    release()
    await run.done
    const [row] = await db.select({ snapshot: chatRequest.snapshot }).from(chatRequest).where(eq(chatRequest.id, run.id))
    expect(row?.snapshot).toBeNull()
    const now = new Date()
    const key = `requests/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${run.id}.json`
    expect(await new FileStorageService(root).exists(key)).toBe(false)
  })

  it('interrupts unfinished requests on process restart even before lease expiry', async () => {
    const { thread } = await tasks.create('member', { assistantId })
    const run = await service.start('member', thread.id, { content: '재시작' }, 'restart-key')
    await run.done
    await db.update(chatRequest).set({ status: 'streaming', leaseUntil: new Date(Date.now() + 30_000) }).where(eq(chatRequest.id, run.id))
    await db.update(message).set({ status: 'streaming' }).where(eq(message.id, run.replyMessageId))
    const restarted = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), provider)
    expect(await restarted.recoverOnStartup()).toBe(1)
    expect((await restarted.get(run.id)).status).toBe('interrupted')
  })

  it('rejects completion while a reply runs and permits it after final storage', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slow: ChatProvider = { ...provider, async *stream() { await gate; yield { type: 'delta', text: '완료' } } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), slow)
    const { task, thread } = await tasks.create('member', { assistantId })
    const run = await runner.start('member', thread.id, { content: '진행' }, 'done-key')
    await expect(tasks.setStatus('member', task.id, 'done')).rejects.toMatchObject({ status: 409 })
    release()
    await run.done
    await tasks.setStatus('member', task.id, 'done')
    await expect(runner.start('member', thread.id, { content: '다시' }, 'after-done')).rejects.toMatchObject({ status: 409 })
  })

  it('times out before the first token and keeps a failed record', async () => {
    const hanging: ChatProvider = { ...provider, async *stream() { await new Promise((resolve) => setTimeout(resolve, 100)); yield { type: 'delta', text: '늦음' } } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root, REQUEST_FIRST_TOKEN_MS: '10', REQUEST_FILES_FIRST_TOKEN_MS: '10' }), hanging)
    const { thread } = await tasks.create('member', { assistantId })
    const run = await runner.start('member', thread.id, { content: '시간 제한' }, 'timeout-key')
    await run.done
    expect(await runner.get(run.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/시간 초과/) })
    expect((await runner.get(run.id)).code).toBe('TIMEOUT')
  })

  it('exposes a machine-readable size failure in GET and SSE', async () => {
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root,
      REQUEST_BUDGET_BYTES: '100' }), provider)
    const { thread } = await tasks.create('member', { assistantId })
    const run = await runner.start('member', thread.id, { content: 'x'.repeat(500) }, 'too-large-code')
    await run.done
    expect(await runner.get(run.id)).toMatchObject({ status: 'failed', code: 'REQUEST_TOO_LARGE' })
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    runner.subscribe(run.id, (event) => events.push(event))()
    expect(events.find((event) => event.event === 'failed')?.data.code).toBe('REQUEST_TOO_LARGE')
  })

  it('limits auxiliary calls to one per user', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const first = service.runAuxiliary('member', 'title', async () => { await gate; return '제목' })
    await expect(service.runAuxiliary('member', 'summary', async () => '요약')).rejects.toMatchObject({ status: 429 })
    release()
    expect(await first).toBe('제목')
  })

  it('does not overwrite a reply closed by another path', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slow: ChatProvider = { ...provider, async *stream() { await gate; yield { type: 'delta', text: '늦은 답' } } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), slow)
    const { thread } = await tasks.create('member', { assistantId })
    const run = await runner.start('member', thread.id, { content: '경쟁' }, 'fenced-key')
    await runner.cancel(run.id)
    release()
    await run.done
    expect((await runner.get(run.id)).status).toBe('cancelled')
    expect((await db.select().from(message).where(eq(message.id, run.replyMessageId)))[0]?.content).not.toContain('늦은 답')
  })

  it('retries only the last failed reply with the same user message', async () => {
    const failing: ChatProvider = { ...provider, async *stream() { yield { type: 'error', message: '모델 오류' } } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), failing)
    const { thread } = await tasks.create('member', { assistantId })
    const first = await runner.start('member', thread.id, { content: '다시' }, 'failed-key')
    await first.done
    expect(await runner.get(first.id)).toMatchObject({ status: 'failed', code: 'PROVIDER_ERROR' })
    const retried = await service.retry('member', first.id, {}, 'retry-key')
    await retried.done
    expect(retried.userMessageId).toBe(first.userMessageId)
    expect((await tasks.messages(thread.id)).filter((item) => item.role === 'user')).toHaveLength(1)
    await expect(service.retry('member', first.id, {}, 'retry-other')).rejects.toMatchObject({ status: 409 })
  })

  it('records a build failure and can retry after excluding its selected file', async () => {
    const { task: owner, thread } = await tasks.create('member', { assistantId })
    const fileId = `missing-${Date.now()}`
    await db.insert(fileObject).values({ id: fileId, kind: 'task_file', originTaskId: owner.id, originalName: 'missing.txt', mime: 'text/plain', sizeBytes: 1,
      sha256: 'a'.repeat(64), storageKey: `test/${fileId}.txt`, source: 'upload', version: 1, uploadedBy: 'member' })
    await db.insert(taskInput).values({ taskId: owner.id, fileId, weight: 'reference', sortOrder: 0, selectedBy: 'member' })
    const failed = await service.start('member', thread.id, { content: '누락 파일' }, 'build-failure')
    await failed.done
    expect(await service.get(failed.id)).toMatchObject({ status: 'failed', code: 'BUILD_FAILED' })
    await expect(service.retry('member', failed.id, { excludeFileIds: ['unrelated'] }, 'invalid-retry')).rejects.toMatchObject({ status: 400 })
    const recovered = await service.retry('member', failed.id, { excludeFileIds: [fileId] }, 'exclude-file')
    await recovered.done
    expect((await service.get(recovered.id)).status).toBe('succeeded')
    expect(await db.select().from(taskInput).where(eq(taskInput.fileId, fileId))).toHaveLength(0)
  })

  it('stops on OpenWebUI delivery failure and retries a text file inline', async () => {
    let chatCalls = 0
    const fileCounts: number[] = []
    const fake = createServer(async (req, res) => {
      if (req.url === '/api/v1/files/') {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        if (Buffer.concat(chunks).includes('fail-input')) res.writeHead(500).end('upload failed')
        else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'remote-good' }))
      } else if (req.url === '/api/v1/files/remote-good/process/status') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'completed' }))
      } else if (req.url === '/api/chat/completions') {
        chatCalls++
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { files?: unknown[] }
        fileCounts.push(payload.files?.length ?? 0)
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end('data: {"choices":[{"delta":{"content":"본문 복구"}}]}\n\ndata: [DONE]\n\n')
      } else res.writeHead(404).end()
    })
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve))
    try {
      const address = fake.address()
      if (!address || typeof address === 'string') throw new Error('가짜 서버 포트가 없습니다')
      const liveConfig = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root,
        LLM_MODE: 'live', LLM_PRESET: 'openwebui', LLM_BASE_URL: `http://127.0.0.1:${address.port}`, LLM_API_KEY: 'secret' })
      const runner = new RequestsService(db, liveConfig, new OpenAICompatibleProvider(toLlmSettings(liveConfig.llm)))
      const { task: owner, thread } = await tasks.create('member', { assistantId })
      const fileId = `fail-${Date.now()}`
      const storageKey = `test/${fileId}.txt`
      await new FileStorageService(root).write(storageKey, Buffer.from('file body'))
      await db.insert(fileObject).values({ id: fileId, kind: 'task_file', originTaskId: owner.id, originalName: 'fail-input.txt', mime: 'text/plain', sizeBytes: 9,
        sha256: 'a'.repeat(64), storageKey, source: 'upload', version: 1, uploadedBy: 'member' })
      await db.insert(taskInput).values({ taskId: owner.id, fileId, weight: 'reference', sortOrder: 0, selectedBy: 'member' })
      const first = await runner.start('member', thread.id, { content: '파일 사용' }, 'delivery-key')
      await first.done
      expect(await runner.get(first.id)).toMatchObject({ status: 'failed', code: 'DELIVERY_FAILED', inputs: [{ fileId, delivery: 'failed' }] })
      expect(chatCalls).toBe(0)
      const recovered = await runner.retry('member', first.id, { forceInlineFileIds: [fileId] }, 'delivery-retry')
      await recovered.done
      expect(await runner.get(recovered.id)).toMatchObject({ status: 'succeeded', inputs: [{ fileId, delivery: 'inline' }] })
      expect(chatCalls).toBeGreaterThanOrEqual(1)
      const second = await tasks.create('member', { assistantId })
      const goodId = `good-${Date.now()}`
      const goodKey = `test/${goodId}.txt`
      await new FileStorageService(root).write(goodKey, Buffer.from('good input'))
      await db.insert(fileObject).values({ id: goodId, kind: 'task_file', originTaskId: second.task.id, originalName: 'good-input.txt', mime: 'text/plain', sizeBytes: 10,
        sha256: 'b'.repeat(64), storageKey: goodKey, source: 'upload', version: 1, uploadedBy: 'member' })
      await db.insert(taskInput).values({ taskId: second.task.id, fileId: goodId, weight: 'main', sortOrder: 0, selectedBy: 'member' })
      const attached = await runner.start('member', second.thread.id, { content: '첨부' }, 'attached-key')
      await attached.done
      const events: unknown[] = []
      runner.subscribe(attached.id, (event) => events.push(event))()
      expect((await runner.get(attached.id)).inputs[0]).toMatchObject({ delivery: 'attached' })
      expect(JSON.stringify(events)).not.toContain('remote-good')
      expect(JSON.stringify(await runner.snapshot(attached.id))).not.toContain('remote-good')
      expect(fileCounts).toContain(1)
    } finally { await new Promise<void>((resolve) => fake.close(() => resolve())) }
  })
})
