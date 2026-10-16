import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { UrlReader, blockedAddress, extractUrls } from './urlReader.js'

const policy = { enabled: true, allowDomains: [], blockDomains: [], selfOrigins: ['http://api.internal:3000'], selfAddresses: ['10.0.0.1'], apiPort: 3000 }
const setup = (open = vi.fn(async () => new Response('<title>제목</title><nav>메뉴</nav><main><p>본문 &amp; 자료</p><script>SECRET</script></main>', { headers: { 'content-type': 'text/html' } }))) => {
  const resolve = vi.fn(async () => [{ address: '10.0.0.2', family: 4 }])
  return { reader: new UrlReader({ resolve, open }), resolve, open }
}

describe('URL reader', () => {
  it('extracts at most three unique HTTP(S) URLs including markdown and Korean punctuation', () => {
    expect(extractUrls('이전 [문서](https://a.test/a_(b)) https://b.test, https://a.test/a_(b) https://c.test。 https://d.test ftp://e.test')).toEqual(['https://a.test/a_(b)', 'https://b.test/', 'https://c.test/'])
  })
  it.each(['127.0.0.1', '127.2.3.4', '169.254.169.254', '0.0.0.0', '::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', 'fd00:ec2::254', '100.100.100.200', '168.63.129.16', '192.0.0.192', '2001::7f00:1'])('blocks special address %s', address => expect(blockedAddress(address)).toBe(true))
  it.each(['10.1.2.3', '172.16.1.1', '192.168.1.2', 'fd12::1', '8.8.8.8'])('allows private and public address %s', address => expect(blockedAddress(address)).toBe(false))
  it('extracts title and body, records bytes, pins the checked address and caches for five minutes', async () => {
    const { reader, open } = setup()
    const first = await reader.read('https://intra.test/doc', policy, { scope: 'u/thread' })
    expect(first[0]).toMatchObject({ url: 'https://intra.test/doc', status: 'read', title: '제목', text: '제목\n본문 & 자료', bytes: expect.any(Number) })
    expect(open.mock.calls[0]).toEqual([new URL('https://intra.test/doc'), { address: '10.0.0.2', family: 4 }, expect.any(AbortSignal)])
    expect(await reader.read('https://intra.test/doc', policy, { scope: 'u/thread' })).toEqual(first)
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('shares an in-flight estimate with sending, so changing pages cannot produce a second body', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const { reader, open } = setup(vi.fn(async () => { await gate; return new Response('one version', { headers: { 'content-type': 'text/plain' } }) }))
    const estimate = reader.read('https://intra.test', policy, { scope: 'same' })
    const sending = reader.read('https://intra.test', policy, { scope: 'same' })
    release()
    expect(await sending).toEqual(await estimate)
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('expires cache and isolates users and policy changes', async () => {
    let now = 0
    const { open, resolve } = setup()
    const reader = new UrlReader({ open, resolve, now: () => now })
    await reader.read('https://intra.test', policy, { scope: 'a' })
    await reader.read('https://intra.test', policy, { scope: 'b' })
    now = 300_001
    await reader.read('https://intra.test', policy, { scope: 'a' })
    expect(open).toHaveBeenCalledTimes(3)
    expect((await reader.read('https://intra.test', { ...policy, blockDomains: ['intra.test'] }, { scope: 'a' }))[0]?.status).toBe('failed')
    expect(open).toHaveBeenCalledTimes(3)
  })
  it('rechecks redirect domains and DNS before connecting', async () => {
    const open = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }))
    const { reader } = setup(open)
    expect((await reader.read('https://intra.test', policy))[0]).toMatchObject({ status: 'failed', error: '차단된 주소' })
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('blocks API aliases and any DNS answer with a forbidden address', async () => {
    const { reader, open, resolve } = setup()
    resolve.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }])
    expect((await reader.read('http://alias.test:3000', policy))[0]?.status).toBe('failed')
    resolve.mockResolvedValueOnce([{ address: '10.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }])
    expect((await reader.read('http://mixed.test', policy))[0]?.status).toBe('failed')
    expect(open).not.toHaveBeenCalled()
  })
  it('blocks IPv4-mapped IPv6 aliases of the API', async () => {
    const { reader, open } = setup()
    expect((await reader.read('http://[::ffff:a00:1]:3000/doc', policy))[0]?.error).toBe('API 자신은 읽을 수 없음')
    expect(open).not.toHaveBeenCalled()
  })
  it('rechecks domain rules and changed DNS on redirects, with a finite hop count', async () => {
    const open = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://blocked.test/doc' } }))
    const { reader, resolve } = setup(open)
    expect((await reader.read('https://intra.test', { ...policy, blockDomains: ['blocked.test'] }))[0]?.error).toBe('도메인 정책 차단')
    expect(open).toHaveBeenCalledTimes(1)
    open.mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/next' } }))
    resolve.mockResolvedValueOnce([{ address: '10.0.0.2', family: 4 }]).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    expect((await reader.read('https://changing.test', policy))[0]?.error).toBe('차단된 주소')
    expect((await reader.read('https://loop.test', policy))[0]?.error).toBe('리다이렉트 한도 초과')
  })
  it('uses domain label boundaries; block wins over allow; disabled performs no IO', async () => {
    const { reader, open, resolve } = setup()
    const p = { ...policy, allowDomains: ['example.test'], blockDomains: ['bad.example.test'] }
    for (const url of ['http://notexample.test', 'http://bad.example.test', 'http://api.internal:3000']) expect((await reader.read(url, p))[0]?.status).toBe('failed')
    expect(await reader.read('https://example.test', { ...p, enabled: false })).toEqual([])
    expect(open).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })
  it('returns raw text and JSON, and rejects binary, HTTP errors and oversize bodies without truncation', async () => {
    for (const mime of ['text/plain', 'application/json']) {
      const { reader } = setup(vi.fn(async () => new Response('{"raw":"<x>"}', { headers: { 'content-type': mime } })))
      expect((await reader.read('https://intra.test', policy))[0]?.text).toBe('{"raw":"<x>"}')
    }
    for (const response of [new Response('pdf', { headers: { 'content-type': 'application/pdf' } }), new Response('secret', { status: 403 }), new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/plain' } })]) {
      const { reader } = setup(vi.fn(async () => response))
      const [result] = await reader.read('https://intra.test', policy)
      expect(result?.status).toBe('failed')
      expect(result?.text).toBe('')
    }
  })
  it('times out stalled DNS and body reads and respects cancellation', async () => {
    vi.useFakeTimers()
    try {
      const reader = new UrlReader({ resolve: () => new Promise(() => {}) })
      const pending = reader.read('https://slow.test', policy)
      await vi.advanceTimersByTimeAsync(15_001)
      expect((await pending)[0]?.error).toBe('응답 시간 초과')
      const { reader: bodyReader } = setup(vi.fn(async () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/plain' } })))
      const body = bodyReader.read('https://body.test', policy)
      await vi.advanceTimersByTimeAsync(15_001)
      expect((await body)[0]?.error).toBe('응답 시간 초과')
      const controller = new AbortController(); controller.abort()
      expect((await reader.read('https://cancel.test', policy, { signal: controller.signal }))[0]?.error).toBe('요청 취소')
    } finally { vi.useRealTimers() }
  })
})

const privateAddress = Object.values(networkInterfaces()).flat().find(item => item?.family === 'IPv4' && !item.internal)?.address
it.skipIf(!privateAddress)('reads a real test server with a pinned private DNS answer and checks every redirect', async () => {
  const seen: string[] = []
  const server = createServer((req, res) => {
    seen.push(req.headers.host ?? '')
    expect(req.headers.cookie).toBeUndefined()
    expect(req.headers.authorization).toBeUndefined()
    if (req.url === '/redirect') { res.writeHead(302, { location: '/article' }); res.end(); return }
    if (req.url === '/blocked') { res.writeHead(302, { location: 'http://127.0.0.1/private' }); res.end(); return }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>실제 문서</title><article>서버 본문</article>')
  })
  await new Promise<void>(resolve => server.listen(0, privateAddress!, resolve))
  try {
    const port = (server.address() as { port: number }).port
    const reader = new UrlReader({ resolve: async () => [{ address: privateAddress!, family: 4 }] })
    const [page] = await reader.read(`http://docs.invalid:${port}/redirect`, policy)
    expect(page).toMatchObject({ status: 'read', text: '실제 문서\n서버 본문', finalUrl: `http://docs.invalid:${port}/article` })
    expect(seen).toEqual([`docs.invalid:${port}`, `docs.invalid:${port}`])
    expect((await reader.read(`http://docs.invalid:${port}/blocked`, policy))[0]?.error).toBe('차단된 주소')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
