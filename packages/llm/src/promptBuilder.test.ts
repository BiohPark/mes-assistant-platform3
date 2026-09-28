// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, ports, createAssistant, appendMessage, selectConversation, uploadFile, startSrConversation, setInput, startConversation } from './__tests__/memory.js'
import { DEFAULT_LLM_SETTINGS, type Assistant, type LlmSettings, type Task, type Thread } from '@mes/domain'
import { buildChatRequest as buildChatRequestWithPorts, type ChatScope } from './promptBuilder.js'

const buildChatRequest = (scope: ChatScope, thread: Thread, history: import('@mes/domain').Message[], opts: import('./promptBuilder.js').BuildOptions = {}) =>
  buildChatRequestWithPorts(scope, thread, history, opts, ports)

const dev = { userId: 'u_dev' }
const input = (id: string) => ({ id, name: id, level1: 'SDLC', level2: id, summary: '', ownerId: 'u_dev', status: 'open' as const, usageExample: '', checklistTemplate: [] })
const text = (name: string, body: string, type = 'text/markdown') => new File([body], name, { type })

async function setLlm(patch: Partial<LlmSettings>) {
  await db.settings.put({ id: 'app', currentUserId: 'u_dev', llm: { ...DEFAULT_LLM_SETTINGS, ...patch } })
}

async function scopeOf(taskId: string): Promise<{ scope: ChatScope; thread: Thread }> {
  const task = (await db.tasks.get(taskId)) as Task
  const assistant = (await db.assistants.get(task.assistantId)) as Assistant
  return { scope: { kind: 'task', task, assistant }, thread: (await db.threads.get(task.threadId!)) as Thread }
}

async function historyOf(threadId: string) {
  return db.messages.where('threadId').equals(threadId).sortBy('createdAt')
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await db.users.bulkPut([{ id: 'u_dev', name: 'Dev', role: '', initials: 'D', color: '' }])
  await setLlm({})
  for (const id of ['urs', 'fds']) await createAssistant(dev, input(id))
})
afterEach(() => vi.unstubAllGlobals())

describe('buildChatRequest — files', () => {
  it('orders main inputs first, then references, then one-shot attachments, and records how each is delivered', async () => {
    const src = await startConversation(dev, { assistantId: 'urs', tags: ['t'] })
    const main = await uploadFile(dev, { taskId: src.task.id }, text('main.md', 'MAIN-BODY'))
    const ref = await uploadFile(dev, { taskId: src.task.id }, text('ref.md', 'REF-BODY'))
    const me = await startConversation(dev, { assistantId: 'fds', tags: ['t'] })
    const pdf = await uploadFile(dev, { taskId: me.task.id }, text('scan.pdf', '%PDF', 'application/pdf'))
    const once = await uploadFile(dev, { taskId: me.task.id }, text('once.txt', 'ONCE-BODY', 'text/plain'))
    await setInput(dev, me.task.id, ref.id, 'reference')
    await setInput(dev, me.task.id, pdf.id, 'reference')
    await setInput(dev, me.task.id, main.id, 'main')
    await appendMessage(dev, me.thread.id, 'user', '질문', [once.id])
    const { scope, thread } = await scopeOf(me.task.id)

    const built = await buildChatRequest(scope, thread, await historyOf(thread.id), { oneShotFileIds: [once.id] })
    const files = built.info.inputs.filter((i) => i.kind === 'file')
    expect(files.map((i) => i.name)).toEqual(['main.md', 'ref.md', 'scan.pdf', 'once.txt'])
    expect(files.map((i) => i.delivery)).toEqual(['inline', 'inline', 'metadata_only', 'inline'])
    expect(files.find((i) => i.name === 'once.txt')).toMatchObject({ oneShot: true, weight: 'reference', source: '이 대화' })
    expect(files[0]).toMatchObject({ weight: 'main', source: expect.stringContaining(src.task.code) })
    const system = built.messages[0].content
    expect(system.indexOf('MAIN-BODY')).toBeLessThan(system.indexOf('REF-BODY'))
    expect(system).toContain('ONCE-BODY')
    expect(built.info).toMatchObject({ provider: 'mock', transport: 'inline', limitBytes: 262144 })
    expect(built.info.bytes).toBeGreaterThan(0)
    expect(built.meta.usedInputs?.[0]).toContain('★ 주 입력 · main.md v1')
  })

  it('OpenWebUI dry run predicts attachments without calling the server', async () => {
    await setLlm({ mode: 'live', baseUrl: 'http://owui.test/api', apiKey: 'k', fileDelivery: 'openwebui' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const me = await startConversation(dev, { assistantId: 'fds' })
    const f = await uploadFile(dev, { taskId: me.task.id }, text('a.md', 'A'))
    await setInput(dev, me.task.id, f.id, 'main')
    const { scope, thread } = await scopeOf(me.task.id)
    const built = await buildChatRequest(scope, thread, [], { dryRun: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(built.info.inputs[0]).toMatchObject({ kind: 'file', delivery: 'attached' })
    expect(built.info.transport).toBe('openwebui')
  })

  it('keeps dry-run and actual budget fields equal when the remote file ID changes', async () => {
    await setLlm({ mode: 'live', baseUrl: 'http://owui.test/api', apiKey: 'k', fileDelivery: 'openwebui' })
    const me = await startConversation(dev, { assistantId: 'fds' })
    const file = await uploadFile(dev, { taskId: me.task.id }, text('budget.md', 'A'))
    await setInput(dev, me.task.id, file.id, 'main')
    const { scope, thread } = await scopeOf(me.task.id)
    const dry = await buildChatRequest(scope, thread, [], { dryRun: true })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/api/v1/files/')
      ? new Response(JSON.stringify({ id: 'a-much-longer-remote-identifier' }), { status: 200 })
      : new Response(JSON.stringify({ status: 'completed' }), { status: 200 })))
    const actual = await buildChatRequest(scope, thread, [])
    const comparable = (value: typeof dry.info) => ({ provider: value.provider, transport: value.transport, model: value.model,
      bytes: value.bytes, limitBytes: value.limitBytes, srCodes: value.srCodes,
      inputs: value.inputs.map((item) => item.kind === 'file' ? { kind: item.kind, fileId: item.fileId, version: item.version,
        weight: item.weight, source: item.source, oneShot: item.oneShot, delivery: item.delivery, bytes: item.bytes }
        : { kind: item.kind, sourceTaskId: item.sourceTaskId, snapshotId: item.snapshotId, mode: item.mode, messageCount: item.messageCount, bytes: item.bytes }) })
    expect(comparable(actual.info)).toEqual(comparable(dry.info))
  })

  it('OpenWebUI failures are reported (not silently inlined); text files can be forced inline', async () => {
    await setLlm({ mode: 'live', baseUrl: 'http://owui.test/api', apiKey: 'k', fileDelivery: 'openwebui' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    const me = await startConversation(dev, { assistantId: 'fds' })
    const f = await uploadFile(dev, { taskId: me.task.id }, text('a.md', 'A-BODY'))
    await setInput(dev, me.task.id, f.id, 'main')
    const { scope, thread } = await scopeOf(me.task.id)
    const failed = await buildChatRequest(scope, thread, [])
    expect(failed.failed.map((i) => i.name)).toEqual(['a.md'])
    expect(failed.info.inputs[0]).toMatchObject({ delivery: 'failed', text: true, error: expect.stringContaining('503') })

    const forced = await buildChatRequest(scope, thread, [], { forceInlineFileIds: [f.id] })
    expect(forced.failed).toHaveLength(0)
    expect(forced.info.inputs[0]).toMatchObject({ delivery: 'inline' })
    expect(forced.messages[0].content).toContain('A-BODY')
  })
})

describe('buildChatRequest — conversations', () => {
  it('includes selected conversation snapshots and records them', async () => {
    const src = await startConversation(dev, { assistantId: 'urs', tags: ['t'] })
    await appendMessage(dev, src.thread.id, 'user', '보관 기간은?')
    await appendMessage(null, src.thread.id, 'assistant', '90일로 합의')
    const me = await startConversation(dev, { assistantId: 'fds', tags: ['t'] })
    await selectConversation(dev, me.task.id, src.task.id, { weight: 'main' })
    const { scope, thread } = await scopeOf(me.task.id)
    const built = await buildChatRequest(scope, thread, [])
    expect(built.info.inputs).toEqual([expect.objectContaining({ kind: 'conversation', code: src.task.code, messageCount: 2, weight: 'main', mode: 'full' })])
    expect(built.messages[0].content).toContain('## 참조 대화 (1)')
    expect(built.messages[0].content).toContain('[assistant] 90일로 합의')
    expect(built.meta.usedInputs?.[0]).toContain(`대화 ${src.task.code}`)
  })
})

describe('buildChatRequest — SR intake', () => {
  it('reads SR attachments at send time (a file uploaded after the scope was captured is included)', async () => {
    await createAssistant(dev, input('intake'))
    await db.settings.update('app', { srIntakeAssistantId: 'intake' })
    const sr = await startSrConversation(dev)
    const intake = (await db.assistants.get('intake')) as Assistant
    const scope: ChatScope = { kind: 'sr', sr, intake, files: [] }
    await uploadFile(dev, { srId: sr.id }, text('req.txt', 'SR-ATTACHMENT', 'text/plain'))
    const thread = (await db.threads.get(sr.threadId)) as Thread
    const built = await buildChatRequest(scope, thread, [])
    expect(built.messages[0].content).toContain('SR-ATTACHMENT')
    expect(built.info.inputs[0]).toMatchObject({ kind: 'file', name: 'req.txt', source: 'SR 첨부' })
  })
})
