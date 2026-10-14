import { expect, it, vi } from 'vitest'
import type { ChatChunk, ChatProvider, ChatRequest } from './provider.js'
import { FIRST_QUESTIONS_PROMPT, parseFirstQuestions, suggestFirstQuestions } from './firstQuestions.js'

const live = (chunks: ChatChunk[], seen: ChatRequest[] = []): ChatProvider => ({
  kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
  async *stream(request) { seen.push(request); for (const chunk of chunks) yield chunk },
})

it('asks the agent model once with its name and description and returns three questions', async () => {
  const seen: ChatRequest[] = []
  const provider = live([{ type: 'delta', text: '1. 알람 원인을 어떻게 찾나요?\n2) "보고서 초안을' }, { type: 'delta', text: ' 써 줄 수 있나요?"\n- 필요한 자료는 무엇인가요?\n4. 넷째 질문' }, { type: 'done' }], seen)
  expect(await suggestFirstQuestions(provider, 'agent-model', { name: '분석 도우미', summary: '설비 데이터를 분석합니다' }))
    .toEqual(['알람 원인을 어떻게 찾나요?', '보고서 초안을 써 줄 수 있나요?', '필요한 자료는 무엇인가요?'])
  expect(seen).toHaveLength(1)
  expect(seen[0]).toMatchObject({ model: 'agent-model', messages: [{ role: 'system', content: FIRST_QUESTIONS_PROMPT }, { role: 'user', content: '이름: 분석 도우미\n설명: 설비 데이터를 분석합니다' }] })
})

it('mock provider makes no call and suggests nothing (screens fall back to defaults)', async () => {
  const stream = vi.fn()
  const mock = { kind: 'mock', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [], stream } as unknown as ChatProvider
  expect(await suggestFirstQuestions(mock, 'm', { name: 'a', summary: '' })).toEqual([])
  expect(stream).not.toHaveBeenCalled()
})

it('throws on provider errors so the caller can retry later instead of storing nothing', async () => {
  await expect(suggestFirstQuestions(live([{ type: 'error', message: '모델 없음' }]), 'm', { name: 'a', summary: '' })).rejects.toThrow('모델 없음')
})

it('drops blank, duplicate and overlong lines without cutting them', () => {
  expect(parseFirstQuestions(`\n1. 같은 질문\n2. 같은 질문\n3. ${'가'.repeat(201)}\n\n4. 마지막 질문`)).toEqual(['같은 질문', '마지막 질문'])
})

it('passes the auxiliary abort signal to the provider', async () => {
  const controller = new AbortController()
  const onAbort = vi.fn()
  const provider: ChatProvider = {
    kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
    async *stream(request) {
      await new Promise<void>((resolve) => { request.signal?.addEventListener('abort', () => { onAbort(); resolve() }, { once: true }) })
      yield { type: 'done' }
    },
  }
  const run = suggestFirstQuestions(provider, 'm', { name: 'a', summary: '' }, controller.signal)
  controller.abort('timeout')
  await expect(run).rejects.toThrow(/중지/)
  expect(onAbort).toHaveBeenCalledOnce()
})
