import { afterEach, expect, it, vi } from 'vitest'
import type { Message, Task } from '@mes/domain'
import type { Db } from '../db/db.module.js'
import { loadConfig } from '../config/config.js'
import { DbConversationInputsService } from '../context/conversation-inputs.service.js'
import { DbLlmPorts } from './dbLlmPorts.js'
import { RequestsService } from '../requests/requests.service.js'
import { TaskExtrasService } from '../tasks/task-extras.service.js'
import { DbTasksService } from '../tasks/tasks.service.js'

afterEach(() => vi.restoreAllMocks())
it('keeps referenced conversation display URLs out of AI resend text without changing the displayed messages', async () => {
  const original = '![image](/cache/generated.png)'
  const displayed: Message = { id: 'reply', threadId: 'h', role: 'assistant', status: 'done', content: '![image](/api/files/f/content)', createdAt: '', attachmentIds: [] }
  const loaded = [{ input: { sourceTaskId: 'source' }, snapshot: { id: 'snapshot' }, messages: [displayed] }]
  vi.spyOn(DbConversationInputsService.prototype, 'load').mockResolvedValue(loaded as unknown as Awaited<ReturnType<DbConversationInputsService['load']>>)
  const db = { select: () => ({ from: () => ({ where: async () => [{ id: 'reply', originalContent: original }] }) }) } as unknown as Db
  const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 'x'.repeat(32), APP_ORIGIN: 'http://localhost:5173' })
  const ports = new DbLlmPorts(db, config, 'user')
  vi.spyOn(ports, 'getTasks').mockResolvedValue([{ id: 'source', assistantId: 'agent' } as Task])
  vi.spyOn(ports, 'getAssistants').mockResolvedValue([])
  const result = await ports.loadConversationInputs('destination')
  expect(result[0]?.messages[0]?.content).toBe(original)
  expect(displayed.content).toBe('![image](/api/files/f/content)')
})

it('loads the original content before summary budget checking and AI transmission', async () => {
  const original = '![image](/cache/original.png)'
  const displayed: Message = { id: 'reply', threadId: 'h', role: 'assistant', status: 'done', content: '![image](/api/files/f/content)', createdAt: '', attachmentIds: [] }
  const db = { select: () => ({ from: () => ({ where: async () => [{ id: 'reply', originalContent: original }] }) }) } as unknown as Db
  const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 'x'.repeat(32), APP_ORIGIN: 'http://localhost:5173' })
  vi.spyOn(DbLlmPorts.prototype, 'getTask').mockResolvedValue({ id: 'task', assistantId: 'agent' } as Task)
  vi.spyOn(DbLlmPorts.prototype, 'getAssistants').mockResolvedValue([])
  vi.spyOn(DbLlmPorts.prototype, 'getUsers').mockResolvedValue([])
  vi.spyOn(DbLlmPorts.prototype, 'getSettings').mockResolvedValue({ llm: { model: 'model' } } as never)
  const sent: string[] = []
  const runner = new RequestsService(db, config, { kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
    async *stream(req: import('@mes/llm').ChatRequest) { sent.push(JSON.stringify(req.messages)); yield { type: 'delta', text: 'summary' }; yield { type: 'done' } } })
  vi.spyOn(runner, 'runAuxiliary').mockImplementation(async (_actor, _kind, operation) => operation(new AbortController().signal))
  await runner.draftConversationSummary('user', 'task', [displayed])
  expect(sent[0]).toContain(original)
  expect(sent[0]).not.toContain('/api/files/')
  expect(displayed.content).toContain('/api/files/')
})

it('uses original content for checklist transmission', async () => {
  const original = '![image](/cache/original.png)'
  const db = { select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve([{ modelId: 'model' }]), {
    orderBy: async () => [{ id: 'reply', threadId: 'h', role: 'assistant', status: 'done', content: '![image](/api/files/f/content)', originalContent: original, createdAt: new Date() }],
  }) }) }) } as unknown as Db
  vi.spyOn(DbTasksService.prototype, 'get').mockResolvedValue({ id: 'task', threadId: 'h', assistantId: 'agent', checklist: [{ id: 'item', label: 'image' }] } as Task)
  const sent: string[] = []
  const extras = new TaskExtrasService(db, { kind: 'live', async *stream(req: import('@mes/llm').ChatRequest) {
    sent.push(JSON.stringify(req.messages)); yield { type: 'error', message: 'stop-after-capture' }
  } } as never, { runAuxiliary: async (_actor: string, _kind: string, operation: (signal: AbortSignal) => Promise<unknown>) => operation(new AbortController().signal) } as never, {} as never, {} as never)
  await extras.review('user', 'task').catch(() => undefined)
  expect(sent[0]).toContain(original)
  expect(sent[0]).not.toContain('/api/files/')
})

it('restores per-step original image text for reference prompts while retaining tool order', async () => {
  const { messagesForAi } = await import('./responseContent.js')
  const displayed: Message = { id: 'reply', threadId: 'h', role: 'assistant', status: 'done', content: '![image](/api/files/f/content)\n끝', createdAt: '', attachmentIds: [], steps: [
    { type: 'text', text: '![image](/api/files/f/content)', originalText: '![image](/cache/original.png)' },
    { type: 'tool', name: 'lookup', input: '', output: 'result', status: 'done' }, { type: 'text', text: '끝' },
  ] }
  const db = { select: () => ({ from: () => ({ where: async () => [{ id: 'reply', originalContent: '![image](/cache/original.png)\n끝', steps: displayed.steps }] }) }) } as unknown as Db
  const rows = await messagesForAi(db, [displayed])
  expect(rows[0]?.steps?.[0]).toMatchObject({ text: '![image](/cache/original.png)' })
  expect(rows[0]?.steps?.map(s => s.type)).toEqual(['text', 'tool', 'text'])
  expect(displayed.steps?.[0]).toMatchObject({ text: '![image](/api/files/f/content)' })
})
