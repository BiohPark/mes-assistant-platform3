import { afterEach, expect, it, vi } from 'vitest'
import { reviewChecklist } from './checklistReview.js'
import type { ChatProvider } from './provider.js'

const checklist = [
  { id: 'c1', label: '근거 확인', required: true, checked: false },
  { id: 'c2', label: '승인 확인', required: false, checked: false },
]

afterEach(() => vi.useRealTimers())

function delayedProvider(chunks: Array<{ after: number; type: 'delta' | 'reasoning'; text: string }>): ChatProvider {
  return {
    kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
    async *stream() {
      for (const chunk of chunks) {
        await new Promise(resolve => setTimeout(resolve, chunk.after))
        yield { type: chunk.type, text: chunk.text }
      }
    },
  }
}

const answer = '[{"no":1,"met":true,"note":"확인됨"}]'

it('waits beyond 30 seconds for the first chunk using the caller deadline', async () => {
  vi.useFakeTimers()
  const result = reviewChecklist(delayedProvider([{ after: 40_000, type: 'delta', text: answer }]), 'model', checklist, [], 'u', undefined, undefined, { firstTokenMs: 60_000, idleMs: 5000 })
  await vi.advanceTimersByTimeAsync(40_000)
  expect((await result).source).toBe('ai')
  expect(vi.getTimerCount()).toBe(0)
})

it('falls back at the configured first-chunk deadline even if the provider ignores abort', async () => {
  vi.useFakeTimers()
  const settled = vi.fn()
  const result = reviewChecklist(delayedProvider([{ after: 100_000, type: 'delta', text: answer }]), 'model', checklist, [], 'u', undefined, undefined, { firstTokenMs: 45_000, idleMs: 5000 }).then(value => { settled(value); return value })
  await vi.advanceTimersByTimeAsync(44_999)
  expect(settled).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect((await result).source).toBe('rule')
})

it('rearms idle time on reasoning and answer chunks without an overall deadline', async () => {
  vi.useFakeTimers()
  const onItem = vi.fn()
  const result = reviewChecklist(delayedProvider([
    { after: 8000, type: 'reasoning', text: '생각 중' },
    { after: 4000, type: 'reasoning', text: '검토 중' },
    { after: 4000, type: 'delta', text: answer.slice(0, 15) },
    { after: 4000, type: 'delta', text: answer.slice(15) },
  ]), 'model', checklist, [], 'u', undefined, onItem, { firstTokenMs: 10_000, idleMs: 5000 })
  await vi.advanceTimersByTimeAsync(20_000)
  expect((await result).source).toBe('ai')
  expect(onItem).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('falls back when reasoning stops for the configured idle interval', async () => {
  vi.useFakeTimers()
  const settled = vi.fn()
  const result = reviewChecklist(delayedProvider([
    { after: 1000, type: 'reasoning', text: '생각 중' },
    { after: 50_000, type: 'delta', text: answer },
  ]), 'model', checklist, [], 'u', undefined, undefined, { firstTokenMs: 10_000, idleMs: 2000 }).then(value => { settled(value); return value })
  await vi.advanceTimersByTimeAsync(2999)
  expect(settled).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect((await result).source).toBe('rule')
})

it('rejects cancellation instead of returning a rule result, even during an unresponsive stream', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const result = reviewChecklist(delayedProvider([{ after: 100_000, type: 'delta', text: answer }]), 'model', checklist, [], 'u', controller.signal, undefined, { firstTokenMs: 60_000, idleMs: 5000 })
  const rejected = expect(result).rejects.toThrow('보조 요청 중지')
  controller.abort()
  await rejected
  expect(vi.getTimerCount()).toBe(1) // provider delay only; review deadline has been cleared
})

it('preserves cancellation when the provider ends after being aborted', async () => {
  const controller = new AbortController()
  const provider: ChatProvider = {
    kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
    stream() {
      return { [Symbol.asyncIterator]() { return { async next() { controller.abort(); return { done: true, value: undefined } } } } }
    },
  }
  await expect(reviewChecklist(provider, 'model', checklist, [], 'u', controller.signal)).rejects.toThrow('보조 요청 중지')
})

it('streams complete judged items before the model finishes, including braces and escaped quotes in notes', async () => {
  const onItem = vi.fn()
  const provider: ChatProvider = {
    kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
    async *stream() {
      yield { type: 'delta', text: '{"items":[{"no":1,"met":true,"note":"근거 {a}와 \\"확인\\""}' }
      expect(onItem).toHaveBeenCalledWith({ itemId: 'c1', met: true, note: '근거 {a}와 "확인"' })
      yield { type: 'delta', text: ',{"no":2,"met":false,"note":"승인' }
      expect(onItem).toHaveBeenCalledTimes(1)
      yield { type: 'delta', text: ' 없음"}]}' }
    },
  }
  const result = await reviewChecklist(provider, 'model', checklist, [], 'u', undefined, onItem)
  expect(result.source).toBe('ai')
  expect(result.met).toBe(1)
  expect(onItem).toHaveBeenCalledTimes(2)
  expect(onItem).toHaveBeenLastCalledWith(result.items[1])
})

it('preserves rule fallback after a provider error and does not mistake reasoning for review items', async () => {
  const onItem = vi.fn()
  const provider: ChatProvider = {
    kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
    async *stream() {
      yield { type: 'reasoning', text: '{"no":1,"met":true,"note":"private"}' }
      yield { type: 'error', message: 'unavailable' }
    },
  }
  const result = await reviewChecklist(provider, 'model', checklist, [], 'u', undefined, onItem)
  expect(result.source).toBe('rule')
  expect(onItem).not.toHaveBeenCalled()
})
