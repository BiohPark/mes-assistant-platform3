import { afterEach, expect, it, vi } from 'vitest'
import type { Message, Task } from '@mes/domain'
import type { Db } from '../db/db.module.js'
import { loadConfig } from '../config/config.js'
import { DbConversationInputsService } from '../context/conversation-inputs.service.js'
import { DbLlmPorts } from './dbLlmPorts.js'

afterEach(() => vi.restoreAllMocks())
it('keeps referenced conversation display URLs out of AI resend text without changing the displayed messages', async () => {
  const original = '![image](/cache/generated.png)'
  const displayed: Message = { id: 'reply', threadId: 'h', role: 'assistant', status: 'done', content: '![image](/api/files/f/content)', createdAt: '', attachmentIds: [] }
  const loaded = [{ input: { sourceTaskId: 'source' }, snapshot: { id: 'snapshot' }, messages: [displayed] }]
  vi.spyOn(DbConversationInputsService.prototype, 'load').mockResolvedValue(loaded as unknown as Awaited<ReturnType<DbConversationInputsService['load']>>)
  const db = { select: () => ({ from: () => ({ where: async () => [{ id: 'reply', content: original }] }) }) } as unknown as Db
  const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 'x'.repeat(32), APP_ORIGIN: 'http://localhost:5173' })
  const ports = new DbLlmPorts(db, config, 'user')
  vi.spyOn(ports, 'getTasks').mockResolvedValue([{ id: 'source', assistantId: 'agent' } as Task])
  vi.spyOn(ports, 'getAssistants').mockResolvedValue([])
  const result = await ports.loadConversationInputs('destination')
  expect(result[0]?.messages[0]?.content).toBe(original)
  expect(displayed.content).toBe('![image](/api/files/f/content)')
})
