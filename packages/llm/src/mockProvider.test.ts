import { afterEach, expect, it, vi } from 'vitest'
import { MockProvider } from './mockProvider.js'
import type { ChatChunk } from './provider.js'

afterEach(() => vi.useRealTimers())
it('reasoning keyword streams thought chunks before the mock answer', async () => {
  vi.useFakeTimers()
  const chunks: ChatChunk[] = []
  const work = (async () => {
    for await (const chunk of new MockProvider().stream({ model: 'm', messages: [{ role: 'user', content: '[reasoning] 확인' }] })) chunks.push(chunk)
  })()
  await vi.advanceTimersByTimeAsync(500)
  expect(chunks).toEqual([{ type: 'reasoning', text: 'PRIVATE_REASONING: 요청을 검토합니다. ' }])
  await vi.advanceTimersByTimeAsync(2500)
  expect(chunks).toHaveLength(3)
  expect(chunks.every(chunk => chunk.type === 'reasoning')).toBe(true)
  await vi.advanceTimersByTimeAsync(10_000)
  await work
  expect(chunks.filter(chunk => chunk.type === 'reasoning')).toHaveLength(3)
  expect(chunks.at(-1)).toEqual({ type: 'done' })
  expect(chunks.filter(chunk => chunk.type === 'delta').map(chunk => chunk.text).join('')).not.toContain('PRIVATE_REASONING')
})
