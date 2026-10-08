import { expect, it, vi } from 'vitest'
import type { ChatChunk, ChatProvider } from './provider.js'
import { refineSrDraft, ruleRefine } from './srRefine.js'

const live = (chunks: ChatChunk[]): ChatProvider => ({
  kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
  async *stream() { for (const chunk of chunks) yield chunk },
})

it('mock provider returns the rule-based cleanup without changing content', async () => {
  const mock: ChatProvider = { kind: 'mock', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [], async *stream() { yield { type: 'done' } } }
  expect(await refineSrDraft(mock, 'm', { title: '  알람   필터 ', body: '본문  \n\n\n\n끝' })).toEqual({ title: '알람 필터', body: '본문\n\n끝' })
  expect(ruleRefine({ title: 'x'.repeat(80), body: '' }).title).toHaveLength(60)
})

it('splits the live answer into a title line and markdown body', async () => {
  const provider = live([{ type: 'delta', text: '제목: "다듬은 제목"\n' }, { type: 'delta', text: '## 배경\n정리된 본문' }, { type: 'done' }])
  expect(await refineSrDraft(provider, 'm', { title: '원래', body: '원래 본문' })).toEqual({ title: '다듬은 제목', body: '## 배경\n정리된 본문' })
})

it('falls back to the rule-based cleanup on provider errors or empty answers', async () => {
  expect(await refineSrDraft(live([{ type: 'error', message: '실패' }]), 'm', { title: ' 원래 ', body: ' 본문 ' })).toEqual({ title: '원래', body: '본문' })
  expect(await refineSrDraft(live([{ type: 'done' }]), 'm', { title: '원래', body: '본문' })).toEqual({ title: '원래', body: '본문' })
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
  const run = refineSrDraft(provider, 'm', { title: 't', body: 'b' }, controller.signal)
  controller.abort('timeout')
  await expect(run).rejects.toThrow(/중지/)
  expect(onAbort).toHaveBeenCalledOnce()
})
