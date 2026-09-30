import { expect, it, vi } from 'vitest'
import type { ChatProvider } from './provider.js'
import { suggestTitle } from './title.js'

it('passes the auxiliary abort signal to the title provider', async () => {
  const controller = new AbortController()
  const onAbort = vi.fn()
  const provider: ChatProvider = {
    kind: 'live', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
    async *stream(request) {
      await new Promise<void>((resolve) => {
        request.signal?.addEventListener('abort', () => { onAbort(); resolve() }, { once: true })
      })
      yield { type: 'done' }
    },
  }
  const run = suggestTitle(provider, 'model', [], controller.signal)
  controller.abort('timeout')
  await expect(run).rejects.toThrow(/중지/)
  expect(onAbort).toHaveBeenCalledOnce()
})
