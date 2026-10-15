import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { drizzle } from 'drizzle-orm/mysql2'
import type { Db } from '../db/db.module.js'
import type { Pool } from 'mysql2/promise'
import { createPool } from '../db/connection.js'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider, type ChatProvider } from '@mes/llm'
import { loadConfig } from '../config/config.js'
import { runMigrations } from '../db/migrate.js'
import { thread as threadTable, appSetting, chatRequest, dbLock, fileObject, message, task, taskInput } from '../db/schema.js'
import { seedCatalog } from '../db/seed.js'
import { appUser, assistant } from '../db/schema.js'
import { createTempDb } from '../test/tempDb.js'
import { DbTasksService } from '../tasks/tasks.service.js'
import { TaskExtrasService } from '../tasks/task-extras.service.js'
import { RequestsService } from './requests.service.js'
import { FileStorageService } from '../files/fileStorage.service.js'
import { DbLlmPorts } from '../llm/dbLlmPorts.js'
import { EventsService } from '../events/events.service.js'
import { SrService } from '../sr/sr.service.js'
import { toLlmSettings } from '../llm/presets.js'

describe('RequestService DB', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let root: string
  let client: Pool
  let db: Db
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
    client = createPool(temp.url)
    db = drizzle(client)
    await seedCatalog(db)
    await db.insert(appUser).values({ id: 'member', name: 'Member', initials: 'M', color: '#123456' })
    assistantId = (await db.select().from(assistant))[0]!.id
    service = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), provider)
    const extras = new TaskExtrasService(db, provider, service, new FileStorageService(root), new EventsService())
    tasks = new DbTasksService(db, undefined, extras)
  })
  afterAll(async () => { service?.onModuleDestroy(); await client?.end(); await temp?.drop(); await rm(root, { recursive: true, force: true }) })

  it.each(['succeeded', 'failed', 'cancelled', 'interrupted'] as const)('updates task activity atomically when a response becomes %s', async status => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let ready!: () => void
    const streaming = new Promise<void>(resolve => { ready = resolve })
    const gated: ChatProvider = { ...provider, async *stream() {
      yield { type: 'delta', text: '부분 응답' }
      ready()
      await gate
      if (status === 'failed') yield { type: 'error', message: '모델 오류' }
      else yield { type: 'done' }
    } }
    const events = new EventsService()
    const published = vi.spyOn(events, 'publish')
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), gated, events)
    const created = await tasks.create('member', { assistantId, title: 'Activity test' })
    const other = await tasks.create('member', { assistantId, title: 'Unrelated conversation' })
    const viewedAt = new Date('2026-01-01T00:00:00Z')
    try {
      const run = await runner.start('member', created.thread.id, { content: '새 응답' }, `activity-${status}`)
      await streaming
      await db.update(task).set({ lastActivityAt: viewedAt }).where(eq(task.id, created.task.id))
      const beforeFinish = Date.now()
      if (status === 'cancelled') await runner.cancel(run.id)
      if (status === 'interrupted') {
        await db.update(chatRequest).set({ leaseUntil: sql`timestampadd(second, -1, current_timestamp(6))` }).where(eq(chatRequest.id, run.id))
        expect(await runner.sweep()).toBe(1)
      }
      release()
      await run.done
      expect(await runner.get(run.id)).toMatchObject({ status })
      const refreshed = await tasks.get(created.task.id)
      expect(Date.parse(refreshed.lastActivityAt)).toBeGreaterThanOrEqual(beforeFinish)
      expect(Date.parse(refreshed.lastActivityAt)).toBeGreaterThan(viewedAt.getTime())
      expect((await tasks.list({}, 'member')).find(item => item.id === created.task.id)?.lastActivityAt).toBe(refreshed.lastActivityAt)
      expect((await tasks.get(other.task.id)).lastActivityAt).toBe(other.task.lastActivityAt)
      expect(published).toHaveBeenCalledWith('request.updated', expect.objectContaining({ taskId: created.task.id, status }))
      // Replaying a finished request and cancelling it again are both no-ops.
      expect((await runner.start('member', created.thread.id, { content: '새 응답' }, `activity-${status}`)).id).toBe(run.id)
      await runner.cancel(run.id)
      expect((await tasks.get(created.task.id)).lastActivityAt).toBe(refreshed.lastActivityAt)
    } finally { release(); runner.onModuleDestroy() }
  })

  it('does not change task activity when a fenced terminal transition rolls back', async () => {
    const created = await tasks.create('member', { assistantId, title: 'Fenced activity' })
    const run = await service.start('member', created.thread.id, { content: '경쟁 응답' }, 'fenced-activity')
    await run.done
    const viewedAt = new Date('2026-01-01T00:00:00Z')
    await db.update(task).set({ lastActivityAt: viewedAt }).where(eq(task.id, created.task.id))
    await db.update(chatRequest).set({ status: 'streaming' }).where(eq(chatRequest.id, run.id))
    // The reply is already done, so the request transition must be rolled back.
    const fenced = service as unknown as { transition: (id: string, status: 'cancelled') => Promise<boolean> }
    expect(await fenced.transition(run.id, 'cancelled')).toBe(false)
    expect((await tasks.get(created.task.id)).lastActivityAt).toBe(viewedAt.toISOString())
    expect((await service.get(run.id)).status).toBe('streaming')
    await db.update(chatRequest).set({ status: 'succeeded' }).where(eq(chatRequest.id, run.id))
  })

  it('resumes held AI requests atomically, reports it in SSE and does not repeat on replay', async () => {
    const created = await tasks.create('member', { assistantId })
    await tasks.setStatus('member', created.task.id, 'on_hold')
    await expect(service.start('member', created.thread.id, { content: 'invalid', attachmentIds: ['missing'] }, 'held-invalid')).rejects.toMatchObject({ status: 400 })
    expect((await tasks.get(created.task.id)).status).toBe('on_hold')
    const run = await service.start('member', created.thread.id, { content: 'resume' }, 'held-request')
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const unsubscribe = service.subscribe(run.id, event => events.push(event))
    await run.done
    unsubscribe()
    expect(events.find(event => event.event === 'started')?.data.autoStarted).toBe(true)
    expect(await tasks.get(created.task.id)).toMatchObject({ status: 'in_progress', startedAt: created.task.startedAt })
    await tasks.setStatus('member', created.task.id, 'on_hold')
    expect((await service.start('member', created.thread.id, { content: 'resume' }, 'held-request')).id).toBe(run.id)
    expect((await tasks.get(created.task.id)).status).toBe('on_hold')
    const started = (await tasks.activity(created.task.id)).filter(item => item.type === 'task.started')
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ userId: 'member', payload: { from: 'on_hold', to: 'in_progress', auto: true } })
    await tasks.setStatus('member', created.task.id, 'done', 'test completion')
    await expect(service.start('member', created.thread.id, { content: 'closed' }, 'held-done')).rejects.toMatchObject({ status: 409 })
    expect((await tasks.get(created.task.id)).status).toBe('done')
  })

  it.each([false, true])('live OpenWebUI dispatch persists final tools/body and one request (reject=%s)', async reject => {
    const bodies: Record<string, unknown>[] = []
    const server = createServer((req, res) => {
      if (req.url === '/api/models') { res.end(JSON.stringify({ data: [{ id: 'fake-general', info: { meta: { toolIds: ['lookup'], skillIds: ['skill_a'], defaultFilterIds: ['filter_a'], defaultFeatureIds: ['web_search'], capabilities: { web_search: true }, terminalId: 'term-1' } } }] })); return }
      if (req.method !== 'POST' || req.url !== '/api/chat/completions') { res.writeHead(404); res.end(); return }
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
        bodies.push(body)
        if (reject && 'tool_ids' in body) { res.writeHead(400); res.end('rejected'); return }
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n')
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root,
      LLM_MODE: 'live', LLM_PRESET: 'openwebui', LLM_API_KEY: 'test-key', LLM_BASE_URL: `http://127.0.0.1:${address.port}`, LLM_DEFAULT_MODEL: 'fake-general', LLM_OWUI_MODE: 'direct' })
    const runner = new RequestsService(db, config, new OpenAICompatibleProvider(toLlmSettings(config.llm)))
    const { thread } = await tasks.create('member', { assistantId, title: 'Tool test' })
    await db.update(threadTable).set({ modelId: 'fake-general' }).where(eq(threadTable.id, thread.id))
    try {
      await db.insert(appSetting).values({ key: 'owuiTools', value: 'auto' }).onDuplicateKeyUpdate({ set: { value: 'auto' } })
      const estimate = await runner.estimate('member', thread.id, { draft: 'tools check' })
      const started = await runner.start('member', thread.id, { content: 'tools check' }, `owui-${reject}`)
      const events: Array<{ event: string; data: Record<string, unknown> }> = []
      const unsubscribe = runner.subscribe(started.id, event => events.push(event))
      await started.done
      unsubscribe()
      const expected = reject ? { mode: 'fallback' } : { mode: 'tools', tool_ids: ['lookup'], features: { web_search: true } }
      expect(await runner.get(started.id)).toMatchObject({ status: 'succeeded', owuiTools: expected, bytes: estimate.bytes })
      expect(events.find(event => event.event === 'completed')?.data.requestInfo).toMatchObject({ owuiTools: expected })
      const snapshot = await runner.snapshot(started.id) as Record<string, unknown>
      expect(snapshot.messages).toEqual(bodies.at(-1)!.messages)
      // 모델 기본 터미널(S13-J)은 본문과 snapshot에 terminal_id로 남고, 전달 기록(owuiTools)에는 없다
      if (reject) { for (const key of ['tool_ids', 'skill_ids', 'filter_ids', 'features', 'terminal_id']) expect(snapshot).not.toHaveProperty(key); expect(bodies).toHaveLength(2); expect(bodies[0]).toMatchObject({ terminal_id: 'term-1' }) }
      else { expect(snapshot).toMatchObject({ tool_ids: ['lookup'], skill_ids: ['skill_a'], filter_ids: ['filter_a'], features: { web_search: true }, terminal_id: 'term-1', params: { function_calling: 'legacy' } }); expect(bodies).toHaveLength(1) }
      expect((await db.select().from(chatRequest).where(eq(chatRequest.threadId, thread.id)))).toHaveLength(1)
      await db.insert(appSetting).values({ key: 'owuiTools', value: 'off' }).onDuplicateKeyUpdate({ set: { value: 'off' } })
      const disabled = await runner.start('member', thread.id, { content: 'disabled' }, `owui-disabled-${reject}`)
      await disabled.done
      expect(await runner.get(disabled.id)).toMatchObject({ owuiTools: { mode: 'basic' } })
      expect(bodies.at(-1)).not.toHaveProperty('tool_ids')
    } finally { runner.onModuleDestroy(); await db.delete(appSetting).where(eq(appSetting.key, 'owuiTools')); await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  /** OpenWebUI v0.12 세션 모드 대역 — 생성은 chat_id만 돌려주고, 채팅 GET이 진행 상태를 보여 준다(S12) */
  async function sessionUpstream(poll: (elapsedMs: number, count: number) => Record<string, unknown>, create?: (body: Record<string, unknown>) => { status: number; body: string; type?: string } | undefined) {
    const bodies: Record<string, unknown>[] = [], deleted: string[] = [], stopped: string[] = []
    let messageId = '', createdAt = 0, polls = 0
    const server = createServer((req, res) => {
      if (req.url === '/api/models') { res.end(JSON.stringify({ data: [{ id: 'fake-general', info: { meta: { toolIds: ['lookup'], skillIds: ['skill_a'], defaultFilterIds: ['filter_a'], defaultFeatureIds: ['web_search'], capabilities: { web_search: true }, terminalId: 'term-1' } } },
        // SR 접수 에이전트용 모델(S13-J) — 대화 요청과 다른 meta
        { id: 'intake-model', info: { meta: { toolIds: ['intake_tool'], skillIds: ['intake_skill'], defaultFilterIds: ['intake_filter'], defaultFeatureIds: ['web_search', 'code_interpreter'],
          capabilities: { web_search: true }, terminalId: 'intake-term', knowledge: [{ id: 'kb' }] } } }] })); return }
      if (req.method === 'GET' && req.url === '/api/v1/chats/owui-chat-1') {
        res.end(JSON.stringify({ id: 'owui-chat-1', chat: { history: { messages: { [messageId]: { id: messageId, role: 'assistant', ...poll(Date.now() - createdAt, ++polls) } } } } }))
        return
      }
      if (req.method === 'DELETE' && req.url?.startsWith('/api/v1/chats/')) { deleted.push(req.url.slice('/api/v1/chats/'.length)); res.end('true'); return }
      if (req.method === 'POST' && req.url?.startsWith('/api/tasks/chat/')) { stopped.push(req.url); res.end('{}'); return }
      if (req.method !== 'POST' || req.url !== '/api/chat/completions') { res.writeHead(404); res.end(); return }
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
        bodies.push(body)
        const custom = create?.(body)
        if (custom) { res.writeHead(custom.status, { 'content-type': custom.type ?? 'application/json' }); res.end(custom.body); return }
        if ('session_id' in body) { messageId = String(body.id); createdAt = Date.now(); res.end(JSON.stringify({ status: true, task_ids: ['task-1'], chat_id: 'owui-chat-1' })); return }
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end('data: {"choices":[{"delta":{"content":"직접 답변"}}]}\n\ndata: [DONE]\n\n')
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root,
      LLM_MODE: 'live', LLM_PRESET: 'openwebui', LLM_API_KEY: 'test-key', LLM_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`, LLM_DEFAULT_MODEL: 'fake-general',
      REQUEST_FIRST_TOKEN_MS: '400', REQUEST_IDLE_MS: '400' })
    const events = new EventsService()
    const runner = new RequestsService(db, config, new OpenAICompatibleProvider(toLlmSettings(config.llm), undefined, { sessionPollMs: 20 }), events)
    const { thread } = await tasks.create('member', { assistantId, title: 'Session test' })
    await db.update(threadTable).set({ modelId: 'fake-general' }).where(eq(threadTable.id, thread.id))
    const close = async () => { runner.onModuleDestroy(); await new Promise<void>(resolve => server.close(() => resolve())) }
    return { bodies, deleted, stopped, runner, events, thread, close }
  }
  const sessionMessage = (statuses: string[], reasoning: string, content: string, done = false) => ({ done, content,
    statusHistory: statuses.map(description => ({ description, done: false })),
    output: [...(reasoning ? [{ type: 'reasoning', content: [{ type: 'output_text', text: reasoning }] }] : []), ...(content ? [{ type: 'message', content: [{ type: 'output_text', text: content }] }] : [])] })

  it('보낸 것=본 것: 제목이 바뀌면(배경 AI 제목 등) 추정을 다시 하면 새 값이고, 실제 전송은 그 마지막 추정과 같다', async () => {
    const { thread } = await tasks.create('member', { assistantId })
    const [owner] = await db.select({ taskId: threadTable.taskId }).from(threadTable).where(eq(threadTable.id, thread.id))
    const before = await service.estimate('member', thread.id, { draft: '후속 질문' })
    // maybeTitle과 같은 배경 이름 바꾸기 — 시스템 프롬프트의 대화 제목이 바뀐다
    await db.update(task).set({ title: '배경에서 바뀐 아주 긴 AI 제목', titleSource: 'ai' }).where(eq(task.id, owner!.taskId!))
    const after = await service.estimate('member', thread.id, { draft: '후속 질문' })
    expect(after.bytes).not.toBe(before.bytes)
    const started = await service.start('member', thread.id, { content: '후속 질문' }, 'estimate-after-rename')
    await started.done
    expect((await service.get(started.id)).bytes).toBe(after.bytes)
    expect(JSON.stringify(await service.snapshot(started.id))).toContain('배경에서 바뀐 아주 긴 AI 제목')
  })

  it('SR 접수 대화도 같은 세션 방식·모델 기본값(접수 에이전트 모델 meta)으로 보낸다 (S13-J)', async () => {
    const upstream = await sessionUpstream(() => sessionMessage([], '', '접수 답변', true))
    const [previous] = await db.select().from(appSetting).where(eq(appSetting.key, 'srIntakeAssistantId'))
    const [intake] = await db.select({ modelId: assistant.modelId }).from(assistant).where(eq(assistant.id, assistantId))
    await db.insert(appSetting).values({ key: 'srIntakeAssistantId', value: assistantId }).onDuplicateKeyUpdate({ set: { value: assistantId } })
    await db.update(assistant).set({ modelId: 'intake-model' }).where(eq(assistant.id, assistantId))
    try {
      const sr = await new SrService(db, tasks, new EventsService()).create('member')
      const started = await upstream.runner.start('member', sr.threadId, { content: '접수 문의' }, 'sr-owui-session')
      await started.done
      expect(await upstream.runner.get(started.id)).toMatchObject({ status: 'succeeded', owuiTools: { mode: 'tools', tool_ids: ['intake_tool'], features: { web_search: true } } })
      expect(upstream.bodies).toHaveLength(1)
      const defaults = { tool_ids: ['intake_tool'], skill_ids: ['intake_skill'], filter_ids: ['intake_filter'], features: { web_search: true }, terminal_id: 'intake-term' }
      expect(upstream.bodies[0]).toMatchObject({ model: 'intake-model', session_id: expect.any(String), parent_id: null, params: { tool_approval_mode: 'full' }, ...defaults })
      // 지식은 OpenWebUI가 모델 meta로 붙인다 — 파일로 흉내 내지 않는다
      expect(upstream.bodies[0]).not.toHaveProperty('files')
      expect(await upstream.runner.snapshot(started.id)).toMatchObject({ mode: 'session', chat_id: 'owui-chat-1', ...defaults })
      expect(upstream.deleted).toEqual(['owui-chat-1'])
    } finally {
      await db.update(assistant).set({ modelId: intake?.modelId ?? null }).where(eq(assistant.id, assistantId))
      if (previous) await db.update(appSetting).set({ value: previous.value }).where(eq(appSetting.key, 'srIntakeAssistantId'))
      else await db.delete(appSetting).where(eq(appSetting.key, 'srIntakeAssistantId'))
      await upstream.close()
    }
  })

  it('OpenWebUI session mode: status is the phase and keeps the request alive; snapshot records mode/chat_id; chat is deleted', async () => {
    // 1초 동안 상태만 늘어난다 — 첫 토큰·유휴 대기(400ms)를 상태가 살려 두지 않으면 시간 초과로 끝난다
    let reading = 0
    const upstream = await sessionUpstream((elapsed, count) => {
      if (elapsed < 1000) return sessionMessage(Array.from({ length: reading = count }, () => 'URL 읽는 중'), '', '')
      return sessionMessage([...Array.from({ length: reading }, () => 'URL 읽는 중'), 'URL 읽음'], '검토', '세션 답변', elapsed > 1100)
    })
    const published = vi.spyOn(upstream.events, 'publish')
    try {
      const estimate = await upstream.runner.estimate('member', upstream.thread.id, { draft: 'https://example.com 읽어 줘' })
      const started = await upstream.runner.start('member', upstream.thread.id, { content: 'https://example.com 읽어 줘' }, 'owui-session')
      const seen: Array<{ event: string; data: Record<string, unknown> }> = []
      const unsubscribe = upstream.runner.subscribe(started.id, event => seen.push(event))
      await started.done
      unsubscribe()
      expect(await upstream.runner.get(started.id)).toMatchObject({ status: 'succeeded', bytes: estimate.bytes, owuiTools: { mode: 'tools', tool_ids: ['lookup'], features: { web_search: true } } })
      expect(seen.filter(event => event.event === 'phase').map(event => event.data.text)).toEqual(['URL 읽는 중', 'URL 읽음', '생각 중', '답변 중'])
      expect(published).toHaveBeenCalledWith('request.updated', expect.objectContaining({ requestId: started.id, status: 'streaming', phase: 'URL 읽는 중' }))
      const [reply] = await db.select().from(message).where(eq(message.id, started.replyMessageId))
      expect(reply).toMatchObject({ content: '세션 답변', reasoning: '검토', status: 'done' })
      const snapshot = await upstream.runner.snapshot(started.id) as Record<string, unknown>
      expect(snapshot).toMatchObject({ mode: 'session', chat_id: 'owui-chat-1', tool_ids: ['lookup'], skill_ids: ['skill_a'], filter_ids: ['filter_a'], features: { web_search: true }, terminal_id: 'term-1', params: { tool_approval_mode: 'full' } })
      expect(snapshot.messages).toEqual(upstream.bodies[0]!.messages)
      expect(upstream.bodies).toHaveLength(1)
      expect(upstream.bodies[0]).toMatchObject({ terminal_id: 'term-1' })
      expect(upstream.bodies[0]).toMatchObject({ parent_id: null, session_id: expect.any(String) })
      expect(upstream.bodies[0]).not.toHaveProperty('user_message')
      expect(upstream.deleted).toEqual(['owui-chat-1'])
      expect(upstream.stopped).toEqual([])
    } finally { await upstream.close() }
  })

  it('OpenWebUI session mode: replace swaps the streamed text; reconnect resumes from the replaced text', async () => {
    const upstream = await sessionUpstream((elapsed) => elapsed < 300 ? sessionMessage([], '', '임시 답변') : sessionMessage([], '', '최종 답변', elapsed > 400))
    try {
      const started = await upstream.runner.start('member', upstream.thread.id, { content: '바꿔 줘' }, 'owui-replace')
      const seen: Array<{ event: string; data: Record<string, unknown> }> = []
      const unsubscribe = upstream.runner.subscribe(started.id, event => {
        seen.push(event)
        if (event.event === 'replace') void upstream.runner.start('member', upstream.thread.id, { content: '바꿔 줘' }, 'owui-replace').then(replayed => upstream.runner.subscribe(replayed.id, item => {
          if (item.event === 'started') seen.push({ event: 'resumed', data: item.data })
        }))
      })
      await started.done
      unsubscribe()
      expect(seen.find(event => event.event === 'replace')?.data).toEqual({ field: 'content', text: '최종 답변' })
      expect(seen.find(event => event.event === 'resumed')?.data).toMatchObject({ resumedText: '최종 답변' })
      const [reply] = await db.select().from(message).where(eq(message.id, started.replyMessageId))
      expect(reply).toMatchObject({ content: '최종 답변', status: 'done' })
    } finally { await upstream.close() }
  })

  it('OpenWebUI auto mode: a rejected session creation falls back to the direct request once; snapshot says direct', async () => {
    const upstream = await sessionUpstream(() => ({}), body => 'session_id' in body ? { status: 400, body: 'private' } : undefined)
    try {
      const started = await upstream.runner.start('member', upstream.thread.id, { content: '폴백 확인' }, 'owui-fallback')
      await started.done
      expect(await upstream.runner.get(started.id)).toMatchObject({ status: 'succeeded', owuiTools: { mode: 'tools' } })
      const snapshot = await upstream.runner.snapshot(started.id) as Record<string, unknown>
      expect(snapshot).toMatchObject({ mode: 'direct', params: { function_calling: 'legacy' } })
      expect(snapshot).not.toHaveProperty('chat_id')
      expect(snapshot.messages).toEqual(upstream.bodies[1]!.messages)
      expect(upstream.bodies.map(body => 'session_id' in body)).toEqual([true, false])
      const [reply] = await db.select().from(message).where(eq(message.id, started.replyMessageId))
      expect(reply?.content).toBe('직접 답변')
    } finally { await upstream.close() }
  })

  it('OpenWebUI session mode: cancelling stops the background task and deletes the chat', async () => {
    const upstream = await sessionUpstream((_, count) => sessionMessage(Array.from({ length: count }, () => '도구 실행 중'), '', ''))
    try {
      const started = await upstream.runner.start('member', upstream.thread.id, { content: '오래 걸리는 일' }, 'owui-cancel')
      await vi.waitFor(async () => expect((await upstream.runner.get(started.id)).phase).toBe('도구 실행 중'))
      await upstream.runner.cancel(started.id)
      await started.done
      await vi.waitFor(() => expect(upstream.stopped).toEqual(['/api/tasks/chat/owui-chat-1/stop']))
      await vi.waitFor(() => expect(upstream.deleted).toEqual(['owui-chat-1']))
      expect(await upstream.runner.get(started.id)).toMatchObject({ status: 'cancelled' })
    } finally { await upstream.close() }
  })

  it('reasoning keeps first-token and idle waits alive, streams phases, persists separately and never enters the next request', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let began!: () => void
    const thinking = new Promise<void>(resolve => { began = resolve })
    const capturing: ChatProvider = { ...provider, async *stream() {
      yield { type: 'reasoning', text: 'PRIVATE_REASONING' }
      began()
      await gate
      yield { type: 'reasoning', text: ' more' }
      yield { type: 'delta', text: '답변' }
      yield { type: 'done' }
    } }
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root,
      REQUEST_FIRST_TOKEN_MS: '300', REQUEST_IDLE_MS: '1000', REQUEST_FLUSH_MS: '20' })
    const runner = new RequestsService(db, config, capturing)
    const { task: owner, thread } = await tasks.create('member', { assistantId })
    try {
      const started = await runner.start('member', thread.id, { content: '사고' }, 'reasoning-first')
      const events: Array<{ event: string; data: Record<string, unknown> }> = []
      const unsubscribe = runner.subscribe(started.id, event => events.push(event))
      await thinking
      await new Promise(resolve => setTimeout(resolve, 400)) // first-token deadline has passed; reasoning armed idle wait
      expect(await runner.get(started.id)).toMatchObject({ status: 'streaming', phase: '생각 중' })
      expect((await tasks.messages(thread.id)).find(row => row.id === started.replyMessageId)).toMatchObject({ content: '', reasoning: 'PRIVATE_REASONING' })
      release()
      await started.done
      unsubscribe()
      expect(await runner.get(started.id)).toMatchObject({ status: 'succeeded' })
      expect(events).toContainEqual({ event: 'reasoning', data: { text: 'PRIVATE_REASONING' } })
      expect(events).toContainEqual({ event: 'phase', data: { text: '생각 중' } })
      expect(events).toContainEqual({ event: 'phase', data: { text: '답변 중' } })
      const saved = (await tasks.messages(thread.id)).find(row => row.id === started.replyMessageId)!
      expect(saved).toMatchObject({ content: '답변', reasoning: 'PRIVATE_REASONING more', status: 'done' })
      const estimate = await runner.estimate('member', thread.id, { draft: '다음' })
      const next = await runner.start('member', thread.id, { content: '다음' }, 'reasoning-next')
      await next.done
      expect((await runner.get(next.id)).bytes).toBe(estimate.bytes)
      expect(JSON.stringify(await runner.snapshot(next.id))).not.toContain('PRIVATE_REASONING')
      expect((await runner.draftConversationSummary('member', owner.id, [{ ...saved, role: 'assistant', status: 'done', kind: undefined,
        authorId: undefined, error: undefined }])).text).not.toContain('PRIVATE_REASONING')
    } finally { release(); runner.onModuleDestroy() }
  })

  it('repeated reasoning deltas reset idle waits until an answer arrives', async () => {
    const thinking: ChatProvider = { ...provider, async *stream() {
      for (let i = 0; i < 4; i++) {
        yield { type: 'reasoning', text: '검토 ' }
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      yield { type: 'delta', text: '완료' }
    } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root,
      REQUEST_FIRST_TOKEN_MS: '2000', REQUEST_IDLE_MS: '500' }), thinking)
    try {
      const { thread } = await tasks.create('member', { assistantId })
      const started = await runner.start('member', thread.id, { content: '주기적 사고' }, 'reasoning-idle')
      await started.done
      expect(await runner.get(started.id)).toMatchObject({ status: 'succeeded' })
      expect((await tasks.messages(thread.id)).find(row => row.id === started.replyMessageId)).toMatchObject({ content: '완료', reasoning: '검토 '.repeat(4) })
    } finally { runner.onModuleDestroy() }
  })

  it('resumes bounded reasoning replay once, restores it from DB after completion and preserves it on cancellation', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let ready!: () => void
    const emitted = new Promise<void>(resolve => { ready = resolve })
    const many: ChatProvider = { ...provider, async *stream() {
      for (let i = 0; i < 2100; i++) yield { type: 'reasoning', text: 'x' }
      ready()
      await gate
      yield { type: 'reasoning', text: '끝' }
      yield { type: 'delta', text: '답변' }
    } }
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root })
    const runner = new RequestsService(db, config, many)
    try {
      const { thread } = await tasks.create('member', { assistantId })
      const started = await runner.start('member', thread.id, { content: '긴 사고' }, 'reasoning-replay')
      await emitted
      const duplicate = await runner.start('member', thread.id, { content: '긴 사고' }, 'reasoning-replay')
      expect(duplicate.id).toBe(started.id)
      const events: Array<{ event: string; data: Record<string, unknown> }> = []
      const unsubscribe = runner.subscribe(started.id, event => events.push(event))
      expect(events[0]).toMatchObject({ event: 'started', data: { resumedText: '', resumedReasoning: 'x'.repeat(2100), createdAt: expect.any(String) } })
      expect(events.filter(event => event.event === 'reasoning')).toHaveLength(0)
      release()
      await started.done
      expect(events.filter(event => event.event === 'reasoning').map(event => event.data.text)).toEqual(['끝'])
      unsubscribe()
      const restarted = new RequestsService(db, config, provider)
      await restarted.start('member', thread.id, { content: '긴 사고' }, 'reasoning-replay')
      const restored: Array<{ event: string; data: Record<string, unknown> }> = []
      restarted.subscribe(started.id, event => restored.push(event))()
      expect(restored[0]).toMatchObject({ event: 'started', data: { resumedText: '답변', resumedReasoning: 'x'.repeat(2100) + '끝' } })
      restarted.onModuleDestroy()
      const cancelThread = (await tasks.create('member', { assistantId })).thread
      let thinking!: () => void
      const began = new Promise<void>(resolve => { thinking = resolve })
      const hold: ChatProvider = { ...provider, async *stream(request) {
        yield { type: 'reasoning', text: '중지 직전 사고' }
        thinking()
        await new Promise<void>(resolve => { request.signal?.addEventListener('abort', () => resolve(), { once: true }) })
      } }
      const cancellable = new RequestsService(db, config, hold)
      const cancelled = await cancellable.start('member', cancelThread.id, { content: '중지' }, 'reasoning-cancel')
      await began
      await cancellable.cancel(cancelled.id)
      await cancelled.done
      expect((await tasks.messages(cancelThread.id)).find(row => row.id === cancelled.replyMessageId)).toMatchObject({ status: 'error', reasoning: '중지 직전 사고' })
      cancellable.onModuleDestroy()
    } finally { release(); runner.onModuleDestroy() }
  })

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

  it('여러 스레드의 진행 중 요청을 전역 설정값 이하로 제한하고 종료 후 다시 허용한다', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const holding: ChatProvider = { ...provider, async *stream() { await held; yield { type: 'delta', text: '응답' }; yield { type: 'done' } } }
    const runner = new RequestsService(db, { ...loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }),
      request: { ...loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' }).request, maxActive: 2 } }, holding)
    try {
      const threads = await Promise.all([0, 1, 2].map(async () => (await tasks.create('member', { assistantId })).thread.id))
      const first = await runner.start('member', threads[0]!, { content: '첫째' }, 'global-first')
      const second = await runner.start('member', threads[1]!, { content: '둘째' }, 'global-second')
      await expect(runner.start('member', threads[2]!, { content: '셋째' }, 'global-third')).rejects.toMatchObject({ status: 429 })
      release()
      await Promise.all([first.done, second.done])
      const third = await runner.start('member', threads[2]!, { content: '셋째' }, 'global-third')
      await third.done
    } finally { release(); runner.onModuleDestroy() }
  })

  it('서로 다른 서비스 인스턴스도 같은 DB 전역 상한을 공유한다', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const holding: ChatProvider = { ...provider, async *stream() { await held; yield { type: 'done' } } }
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root, REQUEST_MAX_ACTIVE: '1' })
    const firstRunner = new RequestsService(db, config, holding)
    const secondRunner = new RequestsService(db, config, holding)
    try {
      const firstThread = (await tasks.create('member', { assistantId })).thread.id
      const secondThread = (await tasks.create('member', { assistantId })).thread.id
      const first = await firstRunner.start('member', firstThread, { content: '첫째' }, 'instance-first')
      await expect(secondRunner.start('member', secondThread, { content: '둘째' }, 'instance-second')).rejects.toMatchObject({ status: 429 })
      release()
      await first.done
    } finally { release(); firstRunner.onModuleDestroy(); secondRunner.onModuleDestroy() }
  })

  it('preserves a manual title while an AI title suggestion is in flight', async () => {
    let beginTitle!: () => void
    let finishTitle!: () => void
    const titleStarted = new Promise<void>((resolve) => { beginTitle = resolve })
    const titleReleased = new Promise<void>((resolve) => { finishTitle = resolve })
    const titleProvider: ChatProvider = { kind: 'live', ping: provider.ping, listModels: provider.listModels,
      async *stream(req) {
        if (req.messages[0]?.content.includes('제목을 한국어')) {
          beginTitle()
          await titleReleased
          yield { type: 'delta', text: 'AI 제목' }
        } else yield { type: 'delta', text: '응답' }
        yield { type: 'done' }
      } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), titleProvider)
    try {
      const { task: owner, thread } = await tasks.create('member', { assistantId })
      const started = await runner.start('member', thread.id, { content: '경쟁 제목' }, 'title-race')
      await started.done
      await titleStarted
      await tasks.update('member', owner.id, { title: '사람이 정한 제목' })
      finishTitle()
      await new Promise((resolve) => setTimeout(resolve, 100))
      await expect.poll(async () => (await tasks.get(owner.id)).title).toBe('사람이 정한 제목')
      expect(await tasks.get(owner.id)).toMatchObject({ title: '사람이 정한 제목', titleSource: 'manual' })
    } finally { finishTitle(); runner.onModuleDestroy() }
  })

  it('estimates the same request info before sending and permits completed conversations', async () => {
    const { task: owner, thread } = await tasks.create('member', { assistantId })
    const estimate = await service.estimate('member', thread.id, { draft: '같은 본문' })
    const started = await service.start('member', thread.id, { content: '같은 본문' }, 'estimate-equal')
    await started.done
    const completed: Array<Record<string, unknown>> = []
    service.subscribe(started.id, (event) => { if (event.event === 'completed') completed.push(event.data) })
    const actual = completed[0]?.requestInfo as import('@mes/domain').RequestInfo
    expect(estimate).toMatchObject({ overLimit: false, attachmentLimit: expect.any(Number) })
    expect({ provider: estimate.provider, transport: estimate.transport, model: estimate.model, limitBytes: estimate.limitBytes,
      bytes: estimate.bytes, srCodes: estimate.srCodes, inputs: estimate.inputs }).toEqual({ provider: actual.provider, transport: actual.transport,
      model: actual.model, limitBytes: actual.limitBytes, bytes: actual.bytes, srCodes: actual.srCodes, inputs: actual.inputs })
    await tasks.setStatus('member', owner.id, 'done', '필수 항목 미확인')
    await expect(service.estimate('member', thread.id, { draft: '조회만' })).resolves.toMatchObject({ overLimit: false })
  })

  it('keeps file delivery and byte estimates identical for pinned and one-shot attachments', async () => {
    const { task: owner, thread } = await tasks.create('member', { assistantId })
    const files = [crypto.randomUUID(), crypto.randomUUID()]
    for (const [index, fileId] of files.entries()) {
      const storageKey = `test/${fileId}.txt`
      await new FileStorageService(root).write(storageKey, Buffer.from(`file ${index}`))
      await db.insert(fileObject).values({ id: fileId, kind: 'task_file', originTaskId: owner.id, originalName: `input-${index}.txt`,
        mime: 'text/plain', sizeBytes: 6, sha256: 'a'.repeat(64), storageKey, source: 'upload', version: 1, uploadedBy: 'member' })
    }
    const body = { draft: '첨부 확인', attachmentIds: files, oneShotFileIds: [files[1]!] }
    const estimate = await service.estimate('member', thread.id, body)
    const started = await service.start('member', thread.id, { content: body.draft, attachmentIds: files, oneShotFileIds: body.oneShotFileIds }, 'estimate-files')
    await started.done
    const completed: Array<Record<string, unknown>> = []
    service.subscribe(started.id, (event) => { if (event.event === 'completed') completed.push(event.data) })
    const actual = completed[0]?.requestInfo as import('@mes/domain').RequestInfo
    const comparable = (info: import('@mes/domain').RequestInfo) => ({ provider: info.provider, transport: info.transport, model: info.model,
      bytes: info.bytes, limitBytes: info.limitBytes, srCodes: info.srCodes, inputs: info.inputs })
    expect(comparable(estimate)).toEqual(comparable(actual))
    expect(actual.inputs).toMatchObject([{ kind: 'file', oneShot: false, delivery: 'inline' }, { kind: 'file', oneShot: true, delivery: 'inline' }])
  })

  it('matches an attachment-only request with a blank draft', async () => {
    const { task: owner, thread } = await tasks.create('member', { assistantId })
    const fileId = crypto.randomUUID(), storageKey = `test/${fileId}.txt`
    await new FileStorageService(root).write(storageKey, Buffer.from('file'))
    await db.insert(fileObject).values({ id: fileId, kind: 'task_file', originTaskId: owner.id, originalName: 'only.txt',
      mime: 'text/plain', sizeBytes: 4, sha256: 'a'.repeat(64), storageKey, source: 'upload', version: 1, uploadedBy: 'member' })
    const estimate = await service.estimate('member', thread.id, { draft: '  ', attachmentIds: [fileId] })
    const started = await service.start('member', thread.id, { content: '  ', attachmentIds: [fileId] }, 'attachment-only')
    await started.done
    const completed: Array<Record<string, unknown>> = []
    service.subscribe(started.id, (event) => { if (event.event === 'completed') completed.push(event.data) })
    const actual = completed[0]?.requestInfo as import('@mes/domain').RequestInfo
    expect(estimate.bytes).toBe(actual.bytes)
    expect(estimate.inputs).toEqual(actual.inputs)
    expect((await tasks.messages(thread.id))[0]?.content).toBe('')
  })

  it('appends a pinned attachment after two existing selected files in estimate and request', async () => {
    const { task: owner, thread } = await tasks.create('member', { assistantId })
    const files = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    for (const [index, fileId] of files.entries()) {
      const storageKey = `test/${fileId}.txt`
      await new FileStorageService(root).write(storageKey, Buffer.from(`file ${index}`))
      await db.insert(fileObject).values({ id: fileId, kind: 'task_file', originTaskId: owner.id, originalName: `input-${index}.txt`,
        mime: 'text/plain', sizeBytes: 6, sha256: 'a'.repeat(64), storageKey, source: 'upload', version: 1, uploadedBy: 'member' })
    }
    await db.insert(taskInput).values(files.slice(0, 2).map((fileId, index) => ({ taskId: owner.id, fileId, weight: 'reference' as const,
      sortOrder: index, selectedBy: 'member' })))
    const estimate = await service.estimate('member', thread.id, { draft: '추가', attachmentIds: [files[2]!] })
    const started = await service.start('member', thread.id, { content: '추가', attachmentIds: [files[2]!] }, 'ordered-inputs')
    await started.done
    const completed: Array<Record<string, unknown>> = []
    service.subscribe(started.id, (event) => { if (event.event === 'completed') completed.push(event.data) })
    const actual = completed[0]?.requestInfo as import('@mes/domain').RequestInfo
    expect(estimate.inputs).toEqual(actual.inputs)
    expect(actual.inputs.filter((input) => input.kind === 'file').map((input) => input.fileId)).toEqual(files)
    expect((await db.select().from(taskInput).where(eq(taskInput.taskId, owner.id))).sort((a, b) => a.sortOrder - b.sortOrder)
      .map((input) => input.sortOrder)).toEqual([0, 1, 2])
  })

  it('publishes request creation only after its row commits', async () => {
    const events = new EventsService()
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32),
      APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), provider, events)
    const { thread } = await tasks.create('member', { assistantId })
    let observed: Promise<unknown> | undefined
    events.subscribe((event) => {
      if (event.event === 'request.updated' && event.data.status === 'pending' && !observed) {
        observed = db.select({ id: chatRequest.id }).from(chatRequest).where(eq(chatRequest.id, event.data.requestId))
      }
    })
    const started = await runner.start('member', thread.id, { content: '커밋 확인' }, 'post-commit-event')
    expect(await observed).toEqual([{ id: started.id }])
    await started.done
  })

  it('rejects idempotency keys beyond the column limit for starts and retries', async () => {
    const { thread } = await tasks.create('member', { assistantId })
    await expect(service.start('member', thread.id, { content: 'test' }, 'x'.repeat(192))).rejects.toMatchObject({ status: 400 })
    const run = await service.start('member', thread.id, { content: 'test' }, 'valid-key')
    await run.done
    await expect(service.retry('member', run.id, {}, 'x'.repeat(192))).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a missing attachment before writing request rows', async () => {
    const { thread } = await tasks.create('member', { assistantId })
    await expect(service.start('member', thread.id, { content: 'test', attachmentIds: ['missing-file'] }, 'missing-attachment')).rejects.toMatchObject({ status: 400 })
    expect(await db.select().from(chatRequest).where(eq(chatRequest.threadId, thread.id))).toEqual([])
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
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const holding: ChatProvider = { ...provider, async *stream() { await held; yield { type: 'delta', text: '응답' }; yield { type: 'done' } } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), holding)
    const { thread } = await tasks.create('member', { assistantId })
    let a: Awaited<ReturnType<RequestsService['start']>> | undefined
    try {
      a = await runner.start('member', thread.id, { content: '첫 요청' }, 'same-key')
      const duplicate = await runner.start('member', thread.id, { content: '첫 요청' }, 'same-key')
      expect(duplicate.id).toBe(a.id)
      const result = await Promise.allSettled([runner.start('member', thread.id, { content: '둘' }, 'other-one'), runner.start('member', thread.id, { content: '셋' }, 'other-two')])
      expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(0)
      expect(result.every((item) => item.status === 'rejected' && item.reason.status === 409)).toBe(true)
      release()
      await a.done
      expect(await db.select().from(chatRequest).where(eq(chatRequest.threadId, thread.id))).toHaveLength(1)
      expect(await tasks.messages(thread.id)).toHaveLength(2)
    } finally { release(); if (a) await a.done; runner.onModuleDestroy() }
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

  it('keeps start and retry lease times on the DB clock when the app clock differs', async () => {
    const failing: ChatProvider = { ...provider, async *stream() { yield { type: 'error', message: '모델 오류' } } }
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root })
    const runner = new RequestsService(db, config, failing)
    const { thread } = await tasks.create('member', { assistantId })
    const actualNow = Date.now.bind(Date)
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => actualNow() + 3_600_000)
    try {
      const first = await runner.start('member', thread.id, { content: '첫 요청' }, 'db-clock-start')
      const [startTime] = await client.query<import('mysql2').RowDataPacket[]>('select current_timestamp(6) as now')
      const [started] = await db.select({ leaseUntil: chatRequest.leaseUntil }).from(chatRequest).where(eq(chatRequest.id, first.id))
      expect(Math.abs(started!.leaseUntil!.getTime() - (startTime[0]!.now as Date).getTime() - config.request.leaseMs)).toBeLessThan(2000)
      await first.done
      const retried = await runner.retry('member', first.id, {}, 'db-clock-retry')
      const [retryTime] = await client.query<import('mysql2').RowDataPacket[]>('select current_timestamp(6) as now')
      const [retryRow] = await db.select({ leaseUntil: chatRequest.leaseUntil }).from(chatRequest).where(eq(chatRequest.id, retried.id))
      expect(Math.abs(retryRow!.leaseUntil!.getTime() - (retryTime[0]!.now as Date).getTime() - config.request.leaseMs)).toBeLessThan(2000)
      await retried.done
    } finally { nowSpy.mockRestore() }
  })

  it('renews a live lease on the DB clock when the app clock differs', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const waiting: ChatProvider = { ...provider, async *stream() { await gate; yield { type: 'done' } } }
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root,
      REQUEST_KEEPALIVE_MS: '20' })
    const runner = new RequestsService(db, config, waiting)
    const { thread } = await tasks.create('member', { assistantId })
    const actualNow = Date.now.bind(Date)
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => actualNow() + 3_600_000)
    let run: Awaited<ReturnType<RequestsService['start']>> | undefined
    try {
      run = await runner.start('member', thread.id, { content: '갱신' }, 'db-clock-renew')
      await db.update(chatRequest).set({ leaseUntil: new Date(0) }).where(eq(chatRequest.id, run.id))
      let renewed: Date | null = null
      for (let i = 0; i < 100; i++) {
        const [row] = await db.select({ leaseUntil: chatRequest.leaseUntil }).from(chatRequest).where(eq(chatRequest.id, run.id))
        renewed = row!.leaseUntil
        if (renewed && renewed.getTime() > 0) break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const [time] = await client.query<import('mysql2').RowDataPacket[]>('select current_timestamp(6) as now')
      expect(Math.abs(renewed!.getTime() - (time[0]!.now as Date).getTime() - config.request.leaseMs)).toBeLessThan(2000)
    } finally { release(); if (run) await run.done; nowSpy.mockRestore() }
  })

  it('preserves unrelated duplicate-key errors on start and retry', async () => {
    const { thread } = await tasks.create('member', { assistantId })
    const duplicate = Object.assign(new Error('other unique key'), { errno: 1062 })
    const transactionSpy = vi.spyOn(db, 'transaction').mockRejectedValueOnce(duplicate)
    try { await expect(service.start('member', thread.id, { content: '첫 요청' }, 'other-unique-start')).rejects.toBe(duplicate) }
    finally { transactionSpy.mockRestore() }
    const failing: ChatProvider = { ...provider, async *stream() { yield { type: 'error', message: '모델 오류' } } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), failing)
    const first = await runner.start('member', thread.id, { content: '재시도' }, 'failed-for-unique')
    await first.done
    const retrySpy = vi.spyOn(db, 'transaction').mockRejectedValueOnce(duplicate)
    try { await expect(service.retry('member', first.id, {}, 'other-unique-retry')).rejects.toBe(duplicate) }
    finally { retrySpy.mockRestore() }
  })

  it('reports an active request after duplicate-key errors on start and retry', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const waiting: ChatProvider = { ...provider, async *stream() { await gate; yield { type: 'done' } } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), waiting)
    const { thread } = await tasks.create('member', { assistantId })
    const duplicate = Object.assign(new Error('active unique key'), { errno: 1062 })
    const first = await runner.start('member', thread.id, { content: '진행 중' }, 'active-first')
    try {
      const startSpy = vi.spyOn(db, 'transaction').mockRejectedValueOnce(duplicate)
      try { await expect(service.start('member', thread.id, { content: '다음' }, 'active-second')).rejects.toMatchObject({ status: 409, response: { code: 'REQUEST_ACTIVE' } }) }
      finally { startSpy.mockRestore() }
    } finally { release(); await first.done }

    const failing: ChatProvider = { ...provider, async *stream() { yield { type: 'error', message: '모델 오류' } } }
    const failedRunner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }), failing)
    const failed = await failedRunner.start('member', thread.id, { content: '실패' }, 'failed-active-test')
    await failed.done
    let releaseRetry!: () => void
    const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve })
    const retryRunner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root }),
      { ...provider, async *stream() { await retryGate; yield { type: 'done' } } })
    const active = await retryRunner.retry('member', failed.id, {}, 'active-retry-first')
    try {
      const retrySpy = vi.spyOn(db, 'transaction').mockRejectedValueOnce(duplicate)
      try { await expect(service.retry('member', failed.id, {}, 'active-retry-second')).rejects.toMatchObject({ status: 409, response: { code: 'REQUEST_ACTIVE' } }) }
      finally { retrySpy.mockRestore() }
    } finally { releaseRetry(); await active.done }
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
    await db.update(chatRequest).set({ status: 'streaming', leaseUntil: sql`timestampadd(second, -1, current_timestamp(6))` }).where(eq(chatRequest.id, run.id))
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
    await db.update(chatRequest).set({ status: 'streaming', leaseUntil: sql`timestampadd(second, -1, current_timestamp(6))` }).where(eq(chatRequest.id, run.id))
    await db.update(message).set({ status: 'streaming' }).where(eq(message.id, run.replyMessageId))
    const original = (service as never as { transition: (...args: unknown[]) => Promise<boolean> }).transition.bind(service)
    const spy = vi.spyOn(service as never as { transition: (...args: unknown[]) => Promise<boolean> }, 'transition').mockImplementation(async (...args) => {
      await db.update(chatRequest).set({ leaseUntil: sql`timestampadd(second, 30, current_timestamp(6))` }).where(eq(chatRequest.id, run.id))
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

  it('큰 snapshot 파일 쓰기 중 취소되어 종료 전이가 실패하면 파일을 삭제한다', async () => {
    let writing!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { writing = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    const original = FileStorageService.prototype.write
    const write = vi.spyOn(FileStorageService.prototype, 'write').mockImplementation(async function (this: FileStorageService, key, bytes) {
      await original.call(this, key, bytes)
      if (key.startsWith('requests/')) { writing(); await held }
    })
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root,
      REQUEST_BUDGET_BYTES: String(2 * 1024 * 1024) }), provider)
    try {
      const { thread } = await tasks.create('member', { assistantId })
      const run = await runner.start('member', thread.id, { content: 'x'.repeat(1_100_000) }, 'cancel-writing-snapshot')
      await started
      await runner.cancel(run.id)
      release()
      await run.done
      const [row] = await db.select({ snapshot: chatRequest.snapshot }).from(chatRequest).where(eq(chatRequest.id, run.id))
      expect(row?.snapshot).toBeNull()
      const now = new Date()
      const key = `requests/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${run.id}.json`
      expect(await new FileStorageService(root).exists(key)).toBe(false)
    } finally { release(); write.mockRestore(); runner.onModuleDestroy() }
  })

  it('interrupts unfinished requests on process restart even before lease expiry', async () => {
    const { thread } = await tasks.create('member', { assistantId })
    const run = await service.start('member', thread.id, { content: '재시작' }, 'restart-key')
    await run.done
    await db.update(chatRequest).set({ status: 'streaming', leaseUntil: sql`timestampadd(second, 30, current_timestamp(6))` }).where(eq(chatRequest.id, run.id))
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
    await tasks.setStatus('member', task.id, 'done', '필수 항목 미확인')
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
    expect(await service.runAuxiliary('member', 'assistant', async () => '도우미')).toBe('도우미') // 도우미 슬롯은 독립(U4)
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
  it('재시도에도 현재 전역 파일 전달 방식을 적용한다', async () => {
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173',
      FILE_STORAGE_ROOT: root, LLM_MODE: 'live', LLM_BASE_URL: 'http://localhost:3101', LLM_API_KEY: 'test-key' })
    const failing: ChatProvider = { ...provider, async *stream() { yield { type: 'error', message: '모델 오류' } } }
    const runner = new RequestsService(db, config, failing)
    try {
      await db.insert(appSetting).values({ key: 'fileDelivery', value: 'openwebui' }).onDuplicateKeyUpdate({ set: { value: 'openwebui' } })
      const { thread } = await tasks.create('member', { assistantId })
      const first = await runner.start('member', thread.id, { content: '재시도' }, 'delivery-setting-first')
      await first.done
      expect((await db.select().from(chatRequest).where(eq(chatRequest.id, first.id)))[0]?.transport).toBe('openwebui')
      await db.update(appSetting).set({ value: 'inline' }).where(eq(appSetting.key, 'fileDelivery'))
      const retried = await runner.retry('member', first.id, {}, 'delivery-setting-retry')
      await retried.done
      expect((await db.select().from(chatRequest).where(eq(chatRequest.id, retried.id)))[0]?.transport).toBe('inline')
    } finally {
      runner.onModuleDestroy()
      await db.delete(appSetting).where(eq(appSetting.key, 'fileDelivery'))
    }
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
    const requestBytes: number[] = []
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
        const body = Buffer.concat(chunks)
        const payload = JSON.parse(body.toString('utf8')) as { files?: unknown[] }
        fileCounts.push(payload.files?.length ?? 0)
        requestBytes.push(body.byteLength)
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
      expect(await runner.get(first.id)).toMatchObject({ hasSnapshot: false })
      await expect(runner.snapshot(first.id)).rejects.toMatchObject({ status: 404 })
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
      const estimate = await runner.estimate('member', second.thread.id, { draft: '첨부' })
      await db.insert(appSetting).values({ key: 'requestBudgetBytes', value: estimate.bytes }).onDuplicateKeyUpdate({ set: { value: estimate.bytes } })
      const attached = await runner.start('member', second.thread.id, { content: '첨부' }, 'attached-key')
      await attached.done
      const events: unknown[] = []
      runner.subscribe(attached.id, (event) => events.push(event))()
      expect((await runner.get(attached.id)).inputs[0]).toMatchObject({ delivery: 'attached' })
      expect(await runner.get(attached.id)).toMatchObject({ hasSnapshot: true, bytes: estimate.bytes, limitBytes: estimate.bytes })
      expect(requestBytes.at(-1)).not.toBe(estimate.bytes)
      expect(JSON.stringify(events)).not.toContain('remote-good')
      expect(JSON.stringify(await runner.snapshot(attached.id))).not.toContain('remote-good')
      expect(await runner.snapshot(attached.id)).toMatchObject({ files: [{ type: 'file', fileId: goodId }] })
      expect(fileCounts).toContain(1)
    } finally {
      await db.delete(appSetting).where(eq(appSetting.key, 'requestBudgetBytes'))
      await new Promise<void>((resolve) => fake.close(() => resolve()))
    }
  })

  it('admit은 DB 진행 중 요청과 메모리 슬롯을 합쳐 전역 상한을 적용하고 행을 쓰지 않는다', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const holding: ChatProvider = { ...provider, async *stream() { await held; yield { type: 'delta', text: '응답' }; yield { type: 'done' } } }
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root, REQUEST_MAX_ACTIVE: '2' })
    const runner = new RequestsService(db, config, holding)
    const countRows = async () => Number((await db.select({ count: sql<number>`count(*)` }).from(chatRequest))[0]?.count ?? 0)
    const before = await countRows()
    try {
      const freeOne = await runner.admit('test')
      const freeTwo = await runner.admit('test')
      await expect(runner.admit('test')).rejects.toMatchObject({ status: 429 })
      const threadId = (await tasks.create('member', { assistantId })).thread.id
      await expect(runner.start('member', threadId, { content: '막힘' }, 'admit-blocked')).rejects.toMatchObject({ status: 429 })
      freeOne(); freeOne()
      const freeThree = await runner.admit('test')
      await expect(runner.admit('test')).rejects.toMatchObject({ status: 429 })
      freeTwo(); freeThree()
      expect(await countRows()).toBe(before)
      const started = await runner.start('member', threadId, { content: '하나' }, 'admit-one')
      const freeFour = await runner.admit('test')
      await expect(runner.admit('test')).rejects.toMatchObject({ status: 429 })
      release()
      await started.done
      const freeFive = await runner.admit('test')
      freeFour(); freeFive()
    } finally { release(); runner.onModuleDestroy() }
  })

  it('admit은 전역 용량 잠금 아래에서 세어 채팅 시작 트랜잭션과 경쟁해도 상한을 넘지 않는다', async () => {
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root, REQUEST_MAX_ACTIVE: '1' })
    const runner = new RequestsService(db, config, provider)
    const threadId = (await tasks.create('member', { assistantId })).thread.id
    const lockKey = 'chat-request:global-capacity'
    let lockTaken!: () => void
    let releaseLock!: () => void
    const taken = new Promise<void>((resolve) => { lockTaken = resolve })
    const released = new Promise<void>((resolve) => { releaseLock = resolve })
    const userMessageId = `race-user-${Date.now()}`, replyMessageId = `race-reply-${Date.now()}`, requestId = `race-request-${Date.now()}`
    // 채팅 시작과 같은 순서: 잠금 → (대기) → 진행 중 행 삽입 → 커밋
    const chatTx = db.transaction(async (tx) => {
      await tx.insert(dbLock).values({ lockKey }).onDuplicateKeyUpdate({ set: { lockKey } })
      await tx.select({ key: dbLock.lockKey }).from(dbLock).where(eq(dbLock.lockKey, lockKey)).for('update')
      lockTaken()
      await released
      const [max] = await tx.select({ seq: sql<number>`coalesce(max(${message.seq}), 0)` }).from(message).where(eq(message.threadId, threadId))
      const seq = Number(max?.seq ?? 0)
      await tx.insert(message).values([{ id: userMessageId, threadId, seq: seq + 1, role: 'user', content: '경쟁', authorId: 'member', status: 'done' },
        { id: replyMessageId, threadId, seq: seq + 2, role: 'assistant', content: '', status: 'streaming' }])
      await tx.insert(chatRequest).values({ id: requestId, threadId, userMessageId, replyMessageId, requestedBy: 'member', idempotencyKey: 'race-key', status: 'pending',
        provider: 'mock', transport: 'inline', model: 'glm-5.2', bytes: 0, limitBytes: 1, leaseUntil: sql`timestampadd(second, 60, current_timestamp(6))` })
    })
    try {
      await taken
      const admitting = runner.admit('test')
      let settled = false
      void admitting.then(() => { settled = true }, () => { settled = true })
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(settled).toBe(false) // 잠금을 기다린다 — 자동 커밋으로 0을 세어 들어가지 않는다
      releaseLock()
      await chatTx
      await expect(admitting).rejects.toMatchObject({ status: 429 }) // 커밋된 진행 중 행을 본다
      await db.update(chatRequest).set({ status: 'failed', leaseUntil: null }).where(eq(chatRequest.id, requestId))
      // 반대 순서: admit이 먼저 슬롯을 쥐면 채팅 시작이 429
      const free = await runner.admit('test')
      await expect(runner.start('member', threadId, { content: '막힘' }, 'race-blocked')).rejects.toMatchObject({ status: 429 })
      free()
    } finally { releaseLock(); await chatTx.catch(() => undefined); runner.onModuleDestroy() }
  })

  it('admit과 채팅 시작을 동시에 섞어 던져도 정확히 상한만큼만 들어간다', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const holding: ChatProvider = { ...provider, async *stream() { await held; yield { type: 'done' } } }
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root, REQUEST_MAX_ACTIVE: '3' })
    const runner = new RequestsService(db, config, holding)
    const threads = await Promise.all([0, 1, 2, 3].map(async () => (await tasks.create('member', { assistantId })).thread.id))
    try {
      const attempts = await Promise.allSettled([
        ...threads.map((threadId, index) => runner.start('member', threadId, { content: '동시' }, `mixed-${index}`)),
        ...[0, 1, 2, 3].map(() => runner.admit('test')),
      ])
      const fulfilled = attempts.filter((item) => item.status === 'fulfilled')
      const rejected = attempts.filter((item): item is PromiseRejectedResult => item.status === 'rejected')
      expect(fulfilled).toHaveLength(3)
      expect(rejected).toHaveLength(5)
      for (const item of rejected) expect(item.reason).toMatchObject({ status: 429 })
      release()
      for (const item of fulfilled) {
        const value = item.value
        if (typeof value === 'function') value()
        else await value.done
      }
      const free = await runner.admit('test')
      free()
    } finally { release(); runner.onModuleDestroy() }
  })

  it('같은 서비스의 다음 start·SR 보조·요약은 전역 모델 교체·해제를 즉시 반영한다', async () => {
    await db.insert(appSetting).values({ key: 'defaultModel', value: 'legacy-model' }).onDuplicateKeyUpdate({ set: { value: 'legacy-model' } })
    const models: string[] = []
    const capturing: ChatProvider = { kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
      async *stream(req) { models.push(req.model); yield { type: 'delta', text: '제목: 다듬은 제목\n다듬은 본문' }; yield { type: 'done' } } }
    const runner = new RequestsService(db, loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root, LLM_DEFAULT_MODEL: 'env-model' }), capturing)
    try {
      const { task: owner, thread } = await tasks.create('member', { assistantId })
      const sr = await new SrService(db, tasks, new EventsService()).create('member')
      for (const [index, override] of ['setting-a', 'setting-b', null].entries()) {
        if (override === null) await db.delete(appSetting).where(eq(appSetting.key, 'defaultModelOverride'))
        else await db.insert(appSetting).values({ key: 'defaultModelOverride', value: override }).onDuplicateKeyUpdate({ set: { value: override } })
        const expected = override ?? 'env-model'
        models.length = 0
        const started = await runner.start('member', thread.id, { content: '기본 모델 확인' }, `default-model-${index}`)
        await started.done
        expect((await db.select({ model: chatRequest.model }).from(chatRequest).where(eq(chatRequest.id, started.id)))[0]?.model).toBe(expected)
        const summary = await runner.draftConversationSummary('member', owner.id, [
          { id: 'dm-0', threadId: thread.id, seq: 0, role: 'user', content: '질문', status: 'done', createdAt: new Date().toISOString(), attachmentIds: [] },
          { id: 'dm-1', threadId: thread.id, seq: 1, role: 'assistant', content: '답변', status: 'done', createdAt: new Date().toISOString(), attachmentIds: [] },
        ])
        expect(summary).toMatchObject({ source: 'ai', model: expected })
        expect(await runner.refineSrDraft('member', sr.threadId, { title: '제목', body: '본문' })).toEqual({ title: '다듬은 제목', body: '다듬은 본문', suggestions: [], source: 'ai', model: expected })
        expect(models.length).toBeGreaterThanOrEqual(3)
        expect(new Set(models)).toEqual(new Set([expected]))
      }
      expect(await db.select().from(appSetting).where(eq(appSetting.key, 'defaultModel'))).toHaveLength(1)
    } finally { runner.onModuleDestroy(); await db.delete(appSetting).where(eq(appSetting.key, 'defaultModelOverride')) }
  })
})
