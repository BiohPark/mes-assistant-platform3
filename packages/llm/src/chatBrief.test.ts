import { expect, it, vi } from 'vitest'
import type { Message } from '@mes/domain'
import type { ChatChunk, ChatProvider, ChatRequest } from './provider.js'
import { CHAT_BRIEF_PROMPT, ChatBriefBudgetError, draftChatBrief, parseChatBrief } from './chatBrief.js'

const live = (chunks: ChatChunk[], seen: ChatRequest[] = []): ChatProvider => ({
  kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
  async *stream(request) { seen.push(request); for (const chunk of chunks) yield chunk },
})
const msg = (seq: number, role: Message['role'], content: string, extra: Partial<Message> = {}): Message =>
  ({ id: `m${seq}`, threadId: 'h', seq, role, content, createdAt: `2026-10-15T00:00:0${seq}.000Z`, attachmentIds: [], status: 'done', ...extra })
const history = [
  msg(1, 'user', '설비 알람 원인을 찾아 줘\n자료는 첨부했어'),
  msg(2, 'user', '팀 의견: 센서 쪽 같음', { kind: 'discussion' }),
  msg(3, 'assistant', '알람 원인은 온도 센서로 보입니다.'),
  msg(4, 'assistant', '중지된 답', { status: 'error' }),
]

it('asks the conversation model once with only the AI-visible transcript and returns two lines', async () => {
  const seen: ChatRequest[] = []
  const provider = live([{ type: 'delta', text: '주제: 설비 알람 원인 분석\n' }, { type: 'delta', text: '다음: 온도 센서 교체 이력을 확인해 보세요' }, { type: 'done' }], seen)
  expect(await draftChatBrief(provider, 'chat-model', history, { limitBytes: 100_000 }))
    .toEqual({ about: '설비 알람 원인 분석', next: '온도 센서 교체 이력을 확인해 보세요', source: 'ai', model: 'chat-model' })
  expect(seen).toHaveLength(1)
  expect(seen[0]).toMatchObject({ model: 'chat-model', messages: [{ role: 'system', content: CHAT_BRIEF_PROMPT },
    { role: 'user', content: '[사용자] 설비 알람 원인을 찾아 줘\n자료는 첨부했어\n\n[assistant] 알람 원인은 온도 센서로 보입니다.' }] })
})

it('mock provider makes no call and returns a deterministic rule card', async () => {
  const stream = vi.fn()
  const mock = { kind: 'mock', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [], stream } as unknown as ChatProvider
  const first = await draftChatBrief(mock, 'm', history, { limitBytes: 1 })
  expect(first).toEqual({ about: '(Mock 대역) 설비 알람 원인을 찾아 줘', next: '(Mock 대역) 마지막 답변을 확인하고 이어서 질문하세요', source: 'rule' })
  expect(await draftChatBrief(mock, 'm', history, { limitBytes: 1 })).toEqual(first)
  expect(stream).not.toHaveBeenCalled()
})

it('refuses an over-budget transcript instead of cutting it', async () => {
  const seen: ChatRequest[] = []
  await expect(draftChatBrief(live([{ type: 'done' }], seen), 'm', history, { limitBytes: 50 })).rejects.toBeInstanceOf(ChatBriefBudgetError)
  expect(seen).toHaveLength(0)
})

it('throws on provider errors and unreadable answers so nothing is stored', async () => {
  await expect(draftChatBrief(live([{ type: 'error', message: '모델 없음' }]), 'm', history, { limitBytes: 100_000 })).rejects.toThrow('모델 없음')
  await expect(draftChatBrief(live([{ type: 'delta', text: '한 줄뿐' }, { type: 'done' }]), 'm', history, { limitBytes: 100_000 })).rejects.toThrow()
})

it('parses labelled lines in any order, strips list marks, and falls back to the first two lines', () => {
  expect(parseChatBrief('- **다음:** 보고서를 검토하세요\n1. 주제: 보고서 초안')).toEqual({ about: '보고서 초안', next: '보고서를 검토하세요' })
  expect(parseChatBrief('\n보고서 초안 작성\n\n검토 요청하기\n셋째')).toEqual({ about: '보고서 초안 작성', next: '검토 요청하기' })
  expect(parseChatBrief('주제:\n다음: 무엇')).toBeUndefined()
  expect(parseChatBrief('')).toBeUndefined()
})

it('passes the auxiliary abort signal to the provider', async () => {
  const controller = new AbortController()
  const provider: ChatProvider = {
    kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
    async *stream(request) {
      await new Promise<void>((resolve) => { request.signal?.addEventListener('abort', () => resolve(), { once: true }) })
      yield { type: 'done' }
    },
  }
  const run = draftChatBrief(provider, 'm', history, { limitBytes: 100_000, signal: controller.signal })
  controller.abort('timeout')
  await expect(run).rejects.toThrow(/중지/)
})
