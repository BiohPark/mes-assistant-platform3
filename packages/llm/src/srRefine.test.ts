import { afterEach, expect, it, vi } from 'vitest'
import type { Message } from '@mes/domain'
import type { ChatChunk, ChatProvider, ChatRequest } from './provider.js'
import { composeSrDraft, parseSrProposal, refineSrDraft, ruleRefine, SrDraftBudgetError } from './srRefine.js'

const LIMIT = 256 * 1024
const live = (chunks: ChatChunk[], seen?: ChatRequest[]): ChatProvider => ({
  kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
  async *stream(request) { seen?.push(request); for (const chunk of chunks) yield chunk },
})
const mock: ChatProvider = { kind: 'mock', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [], async *stream() { yield { type: 'done' } } }
function delayedProvider(chunks: Array<{ after: number; type: 'delta' | 'reasoning'; text: string }>): ChatProvider {
  return {
    kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
    async *stream() {
      for (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, chunk.after))
        yield { type: chunk.type, text: chunk.text }
      }
    },
  }
}
const message = (seq: number, role: Message['role'], content: string, extra: Partial<Message> = {}): Message =>
  ({ id: `m${seq}`, threadId: 't', seq, role, content, status: 'done', createdAt: '2026-10-01', attachmentIds: [], ...extra })
const history: Message[] = [
  message(1, 'user', '알람 필터 요청\n라인 2 알람이 너무 많아요'),
  message(2, 'assistant', '어떤 알람을 줄이고 싶으신가요?'),
  message(3, 'user', '온도 경보만 남기고 싶습니다'),
  message(4, 'user', '접수 본문(내부 메모)', { kind: 'discussion' }),
  message(5, 'assistant', '보내는 중', { status: 'streaming' }),
]

afterEach(() => vi.useRealTimers())

it('parses the title line, markdown body and the trailing recommendation list', () => {
  expect(parseSrProposal('제목: "다듬은 제목"\n## 배경\n정리된 본문\n\n추천:\n- 희망 기한을 적어 주세요\n* 대상 라인 번호\n\n')).toEqual({
    title: '다듬은 제목', body: '## 배경\n정리된 본문', suggestions: ['희망 기한을 적어 주세요', '대상 라인 번호'],
  })
  expect(parseSrProposal('본문만')).toEqual({ title: '', body: '본문만', suggestions: [] })
  expect(parseSrProposal('제목: 제목만\n본문\n추천:')).toEqual({ title: '제목만', body: '본문', suggestions: [] })
})

it('mock provider returns the rule-based cleanup and the rule draft without an AI call', async () => {
  expect(await refineSrDraft(mock, 'm', { title: '  알람   필터 ', body: '본문  \n\n\n\n끝' }, history, { limitBytes: LIMIT })).toEqual({ title: '알람 필터', body: '본문\n\n끝', suggestions: [], source: 'rule' })
  expect(ruleRefine({ title: 'x'.repeat(80), body: '' }).title).toHaveLength(60)
  const composed = await composeSrDraft(mock, 'm', history, { limitBytes: LIMIT })
  expect(composed).toMatchObject({ title: '알람 필터 요청', source: 'rule', suggestions: [] })
  expect(composed.body).toContain('온도 경보만 남기고 싶습니다')
  expect(composed.body).not.toContain('내부 메모')
})

it('compose sends only the finished dialog (no discussion) and splits the answer into title and body', async () => {
  const seen: ChatRequest[] = []
  const onDelta = vi.fn()
  const result = await composeSrDraft(live([{ type: 'delta', text: '제목: 라인 2 온도 경보만 ' }, { type: 'delta', text: '남기기\n## 요청\n온도 경보 외 알람 숨김' }, { type: 'done' }], seen), 'm', history, { limitBytes: LIMIT, onDelta })
  expect(result).toEqual({ title: '라인 2 온도 경보만 남기기', body: '## 요청\n온도 경보 외 알람 숨김', suggestions: [], source: 'ai', model: 'm' })
  expect(onDelta.mock.calls.map(([text]) => text).join('')).toBe('제목: 라인 2 온도 경보만 남기기\n## 요청\n온도 경보 외 알람 숨김')
  const user = seen[0]!.messages.find((item) => item.role === 'user')!.content
  expect(user).toContain('사용자: 알람 필터 요청')
  expect(user).toContain('AI: 어떤 알람을')
  expect(user).not.toContain('내부 메모')
  expect(user).not.toContain('보내는 중')
  expect(seen[0]!.messages[0]!.content).toContain('추측')
})

it('refine keeps the draft, passes the dialog as reference and returns recommendations separately', async () => {
  const seen: ChatRequest[] = []
  const result = await refineSrDraft(live([{ type: 'delta', text: '제목: 다듬은 제목\n다듬은 본문\n추천:\n- 희망 기한' }, { type: 'done' }], seen), 'm', { title: '원래', body: '원래 본문' }, history, { limitBytes: LIMIT })
  expect(result).toEqual({ title: '다듬은 제목', body: '다듬은 본문', suggestions: ['희망 기한'], source: 'ai', model: 'm' })
  const user = seen[0]!.messages.find((item) => item.role === 'user')!.content
  expect(user).toContain('제목: 원래\n원래 본문')
  expect(user).toContain('사용자: 알람 필터 요청')
  expect(seen[0]!.messages[0]!.content).toContain('추천')
})

it('falls back to the rule result (source rule) on provider errors or empty answers', async () => {
  expect(await refineSrDraft(live([{ type: 'error', message: '실패' }]), 'm', { title: ' 원래 ', body: ' 본문 ' }, [], { limitBytes: LIMIT })).toEqual({ title: '원래', body: '본문', suggestions: [], source: 'rule' })
  expect(await refineSrDraft(live([{ type: 'done' }]), 'm', { title: '원래', body: '본문' }, [], { limitBytes: LIMIT })).toEqual({ title: '원래', body: '본문', suggestions: [], source: 'rule' })
  expect(await composeSrDraft(live([{ type: 'error', message: '실패' }]), 'm', history, { limitBytes: LIMIT })).toMatchObject({ title: '알람 필터 요청', source: 'rule' })
})

it('refuses an over-budget conversation instead of truncating it', async () => {
  const long = [message(1, 'user', 'x'.repeat(2000))]
  const provider = live([{ type: 'delta', text: '제목: t\nb' }, { type: 'done' }])
  await expect(composeSrDraft(provider, 'm', long, { limitBytes: 1024 })).rejects.toBeInstanceOf(SrDraftBudgetError)
  await expect(refineSrDraft(provider, 'm', { title: 't', body: 'b' }, long, { limitBytes: 1024 })).rejects.toThrow('한도')
  await expect(composeSrDraft(mock, 'm', long, { limitBytes: 1024 })).rejects.toBeInstanceOf(SrDraftBudgetError)
})

it('falls back at the first-token deadline and re-arms the idle deadline on every chunk', async () => {
  vi.useFakeTimers()
  const steady = refineSrDraft(delayedProvider([
    { after: 8000, type: 'reasoning', text: '생각' }, { after: 4000, type: 'delta', text: '제목: 다듬은\n' }, { after: 4000, type: 'delta', text: '본문' },
  ]), 'm', { title: 't', body: 'b' }, [], { limitBytes: LIMIT, timeouts: { firstTokenMs: 10_000, idleMs: 5000 } })
  await vi.advanceTimersByTimeAsync(20_000)
  expect(await steady).toMatchObject({ title: '다듬은', body: '본문', source: 'ai' })
  expect(vi.getTimerCount()).toBe(0)
  const settled = vi.fn()
  const slow = composeSrDraft(delayedProvider([{ after: 100_000, type: 'delta', text: '제목: t\nb' }]), 'm', history, { limitBytes: LIMIT, timeouts: { firstTokenMs: 45_000, idleMs: 5000 } }).then((value) => { settled(value); return value })
  await vi.advanceTimersByTimeAsync(44_999)
  expect(settled).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect((await slow).source).toBe('rule')
  expect(vi.getTimerCount()).toBe(1) // provider delay only; the first-token deadline has been cleared
})

it('rejects cancellation instead of returning a rule result and passes the abort signal to the provider', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const result = composeSrDraft(delayedProvider([{ after: 100_000, type: 'delta', text: '제목: t\nb' }]), 'm', history, { limitBytes: LIMIT, signal: controller.signal, timeouts: { firstTokenMs: 60_000, idleMs: 5000 } })
  const rejected = expect(result).rejects.toThrow('보조 요청 중지')
  controller.abort()
  await rejected
  vi.useRealTimers()
  const onAbort = vi.fn()
  const provider: ChatProvider = {
    kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
    async *stream(request) {
      await new Promise<void>((resolve) => { request.signal?.addEventListener('abort', () => { onAbort(); resolve() }, { once: true }) })
      yield { type: 'done' }
    },
  }
  const second = new AbortController()
  const pending = refineSrDraft(provider, 'm', { title: '원래', body: '본문' }, [], { limitBytes: LIMIT, signal: second.signal })
  second.abort()
  await expect(pending).rejects.toThrow('보조 요청 중지')
  expect(onAbort).toHaveBeenCalledOnce()
})
