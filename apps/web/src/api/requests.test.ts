import { expect, it, vi } from 'vitest'
import { readSse } from './requests'

it('parses split SSE frames and multiline data from a reader', async () => {
  const encoder = new TextEncoder()
  const chunks = ['event: started\r\ndata: {"requestId":', '"r1"}\r\n\r\nevent: delta\n', 'data: {"text":"안"}\n\n']
  const reader = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close() } }).getReader()
  const seen = vi.fn()
  await readSse(reader, seen)
  expect(seen).toHaveBeenNthCalledWith(1, 'started', { requestId: 'r1' })
  expect(seen).toHaveBeenNthCalledWith(2, 'delta', { text: '안' })
})
