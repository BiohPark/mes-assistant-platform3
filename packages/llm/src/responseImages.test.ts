import { afterEach, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider } from './openaiProvider.js'
import type { ChatChunk } from './provider.js'

const settings = { mode: 'live' as const, preset: 'openwebui' as const, baseUrl: 'https://owui.test/api', apiKey: 'secret', model: 'm', owuiTools: 'off' as const }
const data = 'data:image/png;base64,aW1hZ2U='
afterEach(() => vi.unstubAllGlobals())
const collect = async (mode: 'session' | 'direct', fetcher: typeof fetch) => {
  vi.stubGlobal('fetch', fetcher)
  const chunks: ChatChunk[] = []
  for await (const c of new OpenAICompatibleProvider(settings).stream({ model: 'm', messages: [], owuiMode: mode })) chunks.push(c)
  return chunks
}

it('downloads relative, same-origin absolute and data images in direct mode without changing text', async () => {
  const text = `![one](/api/v1/files/a/content) ![two](https://owui.test/cache/b.png) ![three](${data})`
  const fetched: string[] = []
  const chunks = await collect('direct', async (url, init) => {
    if (String(url).endsWith('/chat/completions')) return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`)
    fetched.push(String(url))
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
    return new Response('image', { headers: { 'content-type': 'image/png' } })
  })
  expect(chunks.filter(c => c.type === 'delta')).toEqual([{ type: 'delta', text }])
  const result = chunks.find(c => c.type === 'images') as any
  expect(result?.images).toHaveLength(3)
  expect(result.images.map((i: any) => [...i.bytes])).toEqual(Array(3).fill([...new TextEncoder().encode('image')]))
  expect(fetched).toEqual(['https://owui.test/api/v1/files/a/content', 'https://owui.test/cache/b.png'])
  expect(chunks.at(-1)).toEqual({ type: 'done' })
})

it('collects message.files images and deduplicates markdown aliases before session DELETE', async () => {
  let id = '', deleted = false
  const chunks = await collect('session', async (url, init) => {
    const path = new URL(String(url)).pathname
    if (path.endsWith('/chat/completions')) { id = JSON.parse(String(init?.body)).id; return Response.json({ chat_id: 'c' }) }
    if (init?.method === 'DELETE') { deleted = true; return Response.json(true) }
    if (path === '/api/v1/chats/c') return Response.json({ chat: { history: { messages: { [id]: { done: true, content: '![one](/api/v1/files/a/content)', files: [{ type: 'image', url: 'https://owui.test/api/v1/files/a/content' }], output: [{ type: 'message', files: [{ type: 'image', url: '/cache/only.png' }] }] } } } } })
    expect(deleted).toBe(false)
    return new Response('image', { headers: { 'content-type': 'image/png' } })
  })
  expect(deleted).toBe(true)
  expect((chunks.find(c => c.type === 'images') as any)?.images).toHaveLength(2)
})

it('keeps failed and foreign images unchanged and records download failures without following redirects', async () => {
  const text = '![bad](/cache/missing.png) ![foreign](https://foreign.test/secret.png) ![redirect](/cache/redirect.png)'
  const fetched: string[] = []
  const chunks = await collect('direct', async (url, init) => {
    if (String(url).endsWith('/chat/completions')) return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`)
    fetched.push(String(url))
    expect(init?.redirect).toBe('manual')
    return new Response('', { status: 404 })
  })
  const result = chunks.find(c => c.type === 'images') as any
  expect(result?.failures).toHaveLength(2)
  expect(result.images).toEqual([])
  expect(fetched).toHaveLength(2)
  expect(chunks.at(-1)).toEqual({ type: 'done' })
})


it('rewrites reference images without changing links that share the same definition or code blocks', async () => {
  const { responseImageUrls, rewriteResponseImageUrls } = await import('./responseImages.js')
  const text = '![image][shared] [link][shared]\n\n[shared]: /cache/a.png "title"\n\n```md\n![code](/cache/a.png)\n```'
  expect(responseImageUrls(text)).toEqual(['/cache/a.png'])
  expect(rewriteResponseImageUrls(text, new Map([['/cache/a.png', '/api/files/f/content']]))).toBe('![image](/api/files/f/content "title") [link][shared]\n\n[shared]: /cache/a.png "title"\n\n```md\n![code](/cache/a.png)\n```')
})

it('decodes data images with MIME parameters in direct compatible mode and records invalid data', async () => {
  const { collectResponseImages } = await import('./responseImages.js')
  const result = await collectResponseImages({ ...settings, preset: 'openai-compatible' }, '![ok](data:image/png;charset=utf-8;base64,aW1hZ2U=) ![bad](data:image/png;base64,inv@lid)')
  expect(result.images).toHaveLength(1)
  expect(result.images[0]?.bytes).toEqual(new TextEncoder().encode('image'))
  expect(result.failures).toHaveLength(1)
})

it('preserves percent-encoded binary data bytes and accepts percent-encoded or unpadded base64', async () => {
  const { collectResponseImages } = await import('./responseImages.js')
  const result = await collectResponseImages(settings, '![binary](data:image/png,%89%50%4E%47) ![encoded](data:image/png;base64,aW1hZ2U%3D) ![unpadded](data:image/png;base64,aW1hZ2U)')
  expect(result.failures).toEqual([])
  expect(result.images.map(image => [...image.bytes])).toEqual([[137, 80, 78, 71], [...new TextEncoder().encode('image')], [...new TextEncoder().encode('image')]])
})
