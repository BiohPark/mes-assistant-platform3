import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider } from './openaiProvider.js'

const provider = new OpenAICompatibleProvider({ mode: 'live', baseUrl: 'https://upstream.example/v1', apiKey: 'top-secret', model: 'example' })
afterEach(() => vi.unstubAllGlobals())

describe('OpenAICompatibleProvider models', () => {
  it('200 응답의 data 누락은 ping과 목록에서 형식 오류다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    expect(await provider.ping()).toEqual({ ok: false, detail: '응답 형식 오류' })
    await expect(provider.listModels()).rejects.toThrow('응답 형식 오류')
  })
  it('문자열이 아닌 모델 id도 형식 오류다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 123 }] }), { status: 200 })))
    expect(await provider.ping()).toEqual({ ok: false, detail: '응답 형식 오류' })
    await expect(provider.listModels()).rejects.toThrow('응답 형식 오류')
  })
  it('500 응답은 두 경로 모두 실패하고 본문을 노출하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('top-secret https://upstream.example/v1', { status: 500 })))
    expect(await provider.ping()).toEqual({ ok: false, detail: 'HTTP 500' })
    await expect(provider.listModels()).rejects.toMatchObject({ message: 'HTTP 500' })
  })
  it('네트워크 예외는 목록에서 고정 오류를 낸다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('top-secret https://upstream.example/v1') }))
    await expect(provider.listModels()).rejects.toMatchObject({ message: '모델 목록 네트워크 오류' })
  })
  it('정상 data에서 id 목록을 반환한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'fake-general' }, { id: 'fake-writer' }] }), { status: 200 })))
    expect(await provider.ping()).toEqual({ ok: true, detail: '모델 2개 확인' })
    expect(await provider.listModels()).toEqual(['fake-general', 'fake-writer'])
  })
})

function sseResponse(frames: string[], extra: { cancel?: () => void } = {}) {
  const encoder = new TextEncoder()
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= frames.length) { controller.close(); return }
      controller.enqueue(encoder.encode(frames[index++]!))
    },
    cancel: extra.cancel,
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
async function collect(iterable: AsyncIterable<{ type: string }>) {
  const out: Array<{ type: string }> = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

describe('OpenAICompatibleProvider limits', () => {
  it('ping·listModels는 리다이렉트를 차단하고 location을 노출하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 307, headers: { location: 'https://evil.example/top-secret' } })))
    const ping = await provider.ping()
    expect(ping.ok).toBe(false)
    expect(ping.detail).not.toMatch(/evil|top-secret|HTTP 307/)
    await expect(provider.listModels()).rejects.toMatchObject({ message: ping.detail })
  })
  it('listModels는 응답 상한을 넘으면 절단하지 않고 실패한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"data":[' + '{"id":"m"},'.repeat(600_000) + '{"id":"z"}]}', { status: 200 })))
    await expect(provider.listModels()).rejects.toMatchObject({ message: '응답 크기 한도 초과' })
  })
  it('stream은 limits.timeoutMs를 넘기면 시간 초과 오류 청크를 낸다', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })))
    const chunks = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }], limits: { timeoutMs: 20 } }))
    expect(chunks).toEqual([{ type: 'error', message: '응답 시간 초과' }])
  })
  it('stream은 SSE 프레임이 maxFrameBytes를 넘으면 명시적으로 실패하고 읽기를 중단한다', async () => {
    const cancel = vi.fn()
    const huge = `data: {"choices":[{"delta":{"content":"${'x'.repeat(200)}`
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', huge, 'y'.repeat(50)], { cancel })))
    const chunks = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }], limits: { maxFrameBytes: 128 } }))
    expect(chunks).toEqual([{ type: 'delta', text: 'ok' }, { type: 'error', message: '응답 프레임 크기 초과' }])
    expect(cancel).toHaveBeenCalled()
  })
  it('limits가 없으면(일반 채팅) 큰 SSE 프레임도 그대로 통과한다 — OpenWebUI RAG sources 프레임', async () => {
    const big = 'y'.repeat(1_500_000)
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([`data: {"sources":[{"document":["${big}"]}],"choices":[{"delta":{"content":"ok"}}]}\n\n`, 'data: [DONE]\n\n'])))
    const chunks = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }))
    expect(chunks).toEqual([{ type: 'delta', text: 'ok' }, { type: 'done' }])
    const limited = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }], limits: { maxFrameBytes: 64 * 1024 } }))
    expect(limited).toEqual([{ type: 'error', message: '응답 프레임 크기 초과' }])
  })
  it('stream은 limits.maxResponseBytes를 넘으면 실패하고 chat/completions도 redirect: manual로 부른다', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"more"}}]}\n\n']))
    vi.stubGlobal('fetch', fetchMock)
    const chunks = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }], limits: { maxResponseBytes: 60 } }))
    expect(chunks).toEqual([{ type: 'delta', text: 'ok' }, { type: 'error', message: '응답 크기 한도 초과' }])
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/chat\/completions$/), expect.objectContaining({ redirect: 'manual' }))
  })
  it('stream은 리다이렉트 응답을 오류 청크로 바꾼다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/top-secret' } })))
    const chunks = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }))
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ type: 'error' })
    expect(JSON.stringify(chunks)).not.toMatch(/evil|top-secret|302/)
  })
  it('stream 기본 동작은 그대로다 — 델타·툴콜·done', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"안녕"}}]}\n\n', 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"f","arguments":"{}"}}]}}]}\n\n', 'data: [DONE]\n\n'])))
    const chunks = await collect(provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }))
    expect(chunks).toEqual([{ type: 'delta', text: '안녕' }, { type: 'tool_call', call: { id: 'c1', name: 'f', arguments: '{}' } }, { type: 'done' }])
  })
})
