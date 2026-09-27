import { describe, expect, it } from 'vitest'
import type { Message } from '@mes/domain'
import type { ChatChunk, ChatProvider, ChatRequest } from './provider.js'
import { SummaryBudgetError, summarizeConversation } from './conversationSummary.js'

const msg = (id: string, role: 'user' | 'assistant', content: string): Message => ({
  id,
  threadId: 't',
  role,
  content,
  authorId: role === 'user' ? 'u1' : undefined,
  createdAt: id,
  attachmentIds: [],
  status: 'done',
})
const users = new Map([['u1', { name: '박', role: '' }]])
const rows = [msg('1', 'user', '보관 기간은?'), msg('2', 'assistant', '# 결정\n보관 90일'), msg('3', 'user', '승인 부서는?'), msg('4', 'assistant', '가상 품질팀')]

function provider(kind: 'mock' | 'live', reply: ChatChunk[]): ChatProvider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = []
  return {
    kind,
    calls,
    ping: async () => ({ ok: true, detail: '' }),
    listModels: async () => [],
    async *stream(req) {
      calls.push(req)
      for (const c of reply) yield c
    },
  }
}

describe('summarizeConversation', () => {
  it('mock mode returns a rule-based stand-in labelled as such, without calling the model', async () => {
    const p = provider('mock', [])
    const r = await summarizeConversation(p, 'm', rows, users, { limitBytes: 10_000 })
    expect(r.source).toBe('rule')
    expect(r.text).toContain('대역')
    expect(r.text).toContain('# 결정')
    expect(r.text).toContain('가상 품질팀')
    expect(p.calls).toHaveLength(0)
  })

  it('live mode sends the transcript with speaker labels and returns the model summary', async () => {
    const p = provider('live', [{ type: 'delta', text: '- 보관 90일' }, { type: 'done' }])
    const r = await summarizeConversation(p, 'm', rows, users, { limitBytes: 10_000 })
    expect(r).toEqual({ text: '- 보관 90일', source: 'ai', model: 'm' })
    expect(p.calls[0].messages[1].content).toContain('[사용자 · 박] 보관 기간은?')
  })

  it('refuses a transcript over the budget instead of splitting or truncating it', async () => {
    const p = provider('live', [])
    await expect(summarizeConversation(p, 'm', rows, users, { limitBytes: 50 })).rejects.toBeInstanceOf(SummaryBudgetError)
    expect(p.calls).toHaveLength(0)
  })

  it('surfaces model errors (no silent fallback)', async () => {
    const p = provider('live', [{ type: 'error', message: 'HTTP 500' }])
    await expect(summarizeConversation(p, 'm', rows, users, { limitBytes: 10_000 })).rejects.toThrow('HTTP 500')
  })
})
