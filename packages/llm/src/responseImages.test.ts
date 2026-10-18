import { afterEach, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider } from './openaiProvider.js'
import type { ChatChunk } from './provider.js'
import { collectResponseImages } from './responseImages.js'

const settings = { mode: 'live' as const, preset: 'openwebui' as const, baseUrl: 'https://owui.test/api', apiKey: 'secret', model: 'm', owuiTools: 'off' as const }
const data = 'data:image/png;base64,aW1hZ2U='
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('limits distinct image attempts to 20 and records every excess item without fetching it', async () => {
  const fetcher = vi.fn(async (_url: unknown) => new Response('image', { headers: { 'content-type': 'image/png' } }))
  vi.stubGlobal('fetch', fetcher)
  const result = await collectResponseImages(settings, Array.from({ length: 101 }, (_, i) => `![i](/cache/${i}.png)`).join(' '))
  expect(fetcher).toHaveBeenCalledTimes(20)
  expect(result.images).toHaveLength(20)
  expect(result.failures).toHaveLength(81)
  expect(result.failures[0]).toEqual({ source: '/cache/20.png', reason: '이미지 개수 한도 초과' })
  expect(result.failures.at(-1)?.source).toBe('/cache/100.png')
})

it('shares a 40 MiB byte budget across remote and data images and records the rest', async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array(20 * 1024 * 1024), { headers: { 'content-type': 'image/png' } }))
  vi.stubGlobal('fetch', fetcher)
  const result = await collectResponseImages(settings, `![a](/cache/a.png) ![b](/cache/b.png) ![c](${data}) ![d](/cache/d.png)`)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(result.images).toHaveLength(2)
  expect(result.failures).toEqual([{ source: data, reason: '이미지 누적 크기 한도 초과' }, { source: '/cache/d.png', reason: '이미지 누적 크기 한도 초과' }])
})

it('bounds a streamed response by remaining bytes without truncating or starting later downloads', async () => {
  let count = 0
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array(++count < 3 ? 19 * 1024 * 1024 : 3 * 1024 * 1024), { headers: { 'content-type': 'image/png' } }))
  const result = await collectResponseImages(settings, ['a', 'b', 'c', 'd'].map(i => `![i](/cache/${i}.png)`).join(' '))
  expect(count).toBe(3)
  expect(result.images).toHaveLength(2)
  expect(result.failures.map(item => item.reason)).toEqual(['이미지 누적 크기 한도 초과', '이미지 누적 크기 한도 초과'])
})

it('returns completed downloads and every interrupted source when a later download times out', async () => {
  const controller = new AbortController()
  let count = 0
  vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
    if (++count === 1) return new Response('first', { headers: { 'content-type': 'image/png' } })
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      controller.abort('timeout')
    })
  })
  const result = await collectResponseImages(settings, '![a](/cache/a.png) ![b](/cache/b.png) ![c](/cache/c.png)', undefined, controller.signal)
  expect(result.images.map(image => image.sources)).toEqual([['/cache/a.png']])
  expect(result.failures).toEqual(['/cache/b.png', '/cache/c.png'].map(source => ({ source, reason: '이미지 다운로드 시간 초과' })))
  expect(count).toBe(2)
})

it('keeps earlier and later successes when one download exceeds its own timeout', async () => {
  vi.useFakeTimers()
  let started!: () => void
  const downloading = new Promise<void>(resolve => { started = resolve })
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    if (!String(url).endsWith('/b.png')) return new Response('image', { headers: { 'content-type': 'image/png' } })
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      started()
    })
  })
  const result = collectResponseImages(settings, '![a](/cache/a.png) ![b](/cache/b.png) ![c](/cache/c.png)')
  await downloading
  await vi.advanceTimersByTimeAsync(15_001)
  expect((await result).images.map(image => image.sources)).toEqual([['/cache/a.png'], ['/cache/c.png']])
  expect((await result).failures).toEqual([{ source: '/cache/b.png', reason: '응답 시간 초과' }])
})

it('rejects individual responses over 20 MiB without truncation', async () => {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array(20 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } }))
  const result = await collectResponseImages(settings, '![i](/cache/too-large.png)')
  expect(result.images).toEqual([])
  expect(result.failures).toEqual([{ source: '/cache/too-large.png', reason: '응답 크기 한도 초과' }])
})

it('delivers partial image progress before outer abort handlers finalize a request', async () => {
  const controller = new AbortController()
  const delivered: unknown[] = []
  vi.stubGlobal('fetch', async () => new Response('first', { headers: { 'content-type': 'image/png' } }))
  const result = await collectResponseImages(settings, '![a](/cache/a.png) ![b](/cache/b.png)', undefined, controller.signal, progress => {
    delivered.push(progress)
    if (progress.images.length) controller.abort('timeout')
  })
  expect(delivered).toEqual([{ images: [], failures: [] }, { images: [result.images[0]], failures: [] }, { images: [], failures: result.failures }])
  expect(result.images).toHaveLength(1)
  expect(result.failures).toEqual([{ source: '/cache/b.png', reason: '이미지 다운로드 시간 초과' }])
})

it.each(['direct', 'session'] as const)('passes incremental image results through the %s provider before request timeout', async mode => {
  const controller = new AbortController()
  const progress: import('./responseImages.js').ResponseImages[] = []
  let messageId = ''
  const content = '![a](/cache/a.png) ![b](/cache/b.png)'
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith('/chat/completions')) {
      if (mode === 'direct') return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`)
      messageId = JSON.parse(String(init?.body)).id
      return Response.json({ chat_id: 'c' })
    }
    if (init?.method === 'DELETE') return Response.json(true)
    if (String(url).endsWith('/api/v1/chats/c')) return Response.json({ chat: { history: { messages: { [messageId]: { done: true, content } } } } })
    return new Response('first', { headers: { 'content-type': 'image/png' } })
  })
  const chunks: ChatChunk[] = []
  for await (const chunk of new OpenAICompatibleProvider(settings).stream({ model: 'm', messages: [], owuiMode: mode, signal: controller.signal,
    onResponseImages: result => { progress.push(result); if (result.images.length) controller.abort('timeout') } })) chunks.push(chunk)
  expect(progress.flatMap(item => item.images)).toHaveLength(1)
  expect(progress.flatMap(item => item.failures)).toEqual([{ source: '/cache/b.png', reason: '이미지 다운로드 시간 초과' }])
  expect(chunks.filter(item => item.type === 'images')).toEqual([])
  expect(chunks.at(-1)).toEqual({ type: 'error', message: '응답 시간 초과' })
})

it('decodes Markdown URL entities and escapes once for both downloads and rewriting', async () => {
  const { responseImageUrls, rewriteResponseImageUrls } = await import('./responseImages.js')
  const inline = String.raw`![i](/cache/a.png?x=1&amp;y=&#x32;\&z=&#51;&copy;&CounterClockwiseContourIntegral;&amp;amp;)`
  const url = '/cache/a.png?x=1&y=2&z=3©∳&amp;'
  const reference = '![i][ref]\n\n[ref]: </cache/a.png?x=1&amp;y=&#50;>'
  expect(responseImageUrls(inline)).toEqual([url])
  expect(responseImageUrls(reference)).toEqual(['/cache/a.png?x=1&y=2'])
  expect(rewriteResponseImageUrls(inline, new Map([[url, '/api/files/f/content']]))).toBe('![i](/api/files/f/content)')
  expect(rewriteResponseImageUrls(reference, new Map([['/cache/a.png?x=1&y=2', '/api/files/f/content']]))).toBe('![i](/api/files/f/content)\n\n[ref]: </cache/a.png?x=1&amp;y=&#50;>')
  const fetcher = vi.fn(async (_url: unknown) => new Response('image', { headers: { 'content-type': 'image/png' } }))
  vi.stubGlobal('fetch', fetcher)
  const result = await collectResponseImages(settings, '![i](/cache/a.png?x=1&amp;y=2)')
  expect(fetcher.mock.calls[0]?.[0]).toBe('https://owui.test/cache/a.png?x=1&y=2')
  expect(result.images[0]?.sources).toEqual(['/cache/a.png?x=1&y=2'])
})

it('leaves unknown entity names untouched, including inherited object names', async () => {
  const { responseImageUrls } = await import('./responseImages.js')
  expect(responseImageUrls('![i](/cache/a.png?x=&constructor;&toString;&unknown;)')).toEqual(['/cache/a.png?x=&constructor;&toString;&unknown;'])
})

it('counts bytes from a failed stream against the total download budget', async () => {
  let count = 0
  vi.stubGlobal('fetch', async () => {
    if (++count !== 1) return new Response(new Uint8Array(20 * 1024 * 1024), { headers: { 'content-type': 'image/png' } })
    let pulls = 0
    return new Response(new ReadableStream({ pull(controller) {
      if (pulls++ === 0) controller.enqueue(new Uint8Array(20 * 1024 * 1024))
      else controller.error(new Error('connection lost after body bytes'))
    } }), { headers: { 'content-type': 'image/png' } })
  })
  const result = await collectResponseImages(settings, '![a](/cache/a.png) ![b](/cache/b.png) ![c](/cache/c.png)')
  expect(count).toBe(2)
  expect(result.images).toHaveLength(1)
  expect(result.failures.at(-1)).toEqual({ source: '/cache/c.png', reason: '이미지 누적 크기 한도 초과' })
})

it.each(['image/png', 'image/jpeg; charset=binary', 'IMAGE/SVG+XML', 'image/avif', 'image/x-vendor'])('accepts image MIME responses: %s', async mime => {
  vi.stubGlobal('fetch', async () => new Response('image', { headers: { 'content-type': mime } }))
  const result = await collectResponseImages(settings, '![i](/cache/image)')
  expect(result.images).toHaveLength(1)
  expect(result.images[0]?.mime).toBe(mime.split(';')[0]!.toLowerCase())
  expect(result.failures).toEqual([])
})

it.each(['text/html', 'application/octet-stream', ''])('rejects non-image MIME responses: %s', async mime => {
  vi.stubGlobal('fetch', async () => new Response('not an image', { headers: { 'content-type': mime } }))
  const result = await collectResponseImages(settings, '![i](/cache/image)')
  expect(result.images).toEqual([])
  expect(result.failures).toEqual([{ source: '/cache/image', reason: '이미지가 아닌 응답' }])
})

it.each([301, 302, 307, 308])('rejects an actual %i redirect response without sending the credential to Location', async status => {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.redirect).toBe('manual')
    return new Response(null, { status, headers: { Location: 'https://foreign.test/private' } })
  })
  vi.stubGlobal('fetch', fetcher)
  const result = await collectResponseImages(settings, '![i](/cache/redirect)')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(result.images).toEqual([])
  expect(result.failures).toEqual([{ source: '/cache/redirect', reason: '리다이렉트 응답은 허용하지 않습니다' }])
})
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
