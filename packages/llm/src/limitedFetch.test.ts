import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIMITED_FETCH_MESSAGES, LimitedFetchError, limitedFetch, toLimitedFetchError } from './limitedFetch.js'

afterEach(() => vi.unstubAllGlobals())

function streamOf(chunks: string[], delayMs = 0) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

describe('limitedFetch', () => {
  it('항상 redirect: manual로 호출하고 3xx 응답은 location 없이 실패한다', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/top-secret' } }))
    vi.stubGlobal('fetch', fetchMock)
    const error = await limitedFetch('https://upstream.example/v1/models', { method: 'GET' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LimitedFetchError)
    expect((error as LimitedFetchError).code).toBe('redirect')
    expect((error as Error).message).not.toContain('evil.example')
    expect(fetchMock).toHaveBeenCalledWith('https://upstream.example/v1/models', expect.objectContaining({ method: 'GET', redirect: 'manual', signal: expect.any(AbortSignal) }))
  })

  it('timeoutMs 안에 응답이 없으면 timeout으로 실패한다', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError')))
    })))
    const error = await limitedFetch('https://upstream.example/v1/models', {}, { timeoutMs: 20 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LimitedFetchError)
    expect((error as LimitedFetchError).code).toBe('timeout')
  })

  it('timeoutMs는 본문을 읽는 시간까지 포함한다', async () => {
    let abort: (() => void) | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":'))
        abort = () => controller.error(init.signal?.reason ?? new DOMException('aborted', 'AbortError'))
        init.signal?.addEventListener('abort', () => abort?.())
      } })
      return new Response(body, { status: 200 })
    }))
    const response = await limitedFetch('https://upstream.example/v1/models', {}, { timeoutMs: 20 })
    const error = await response.text().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LimitedFetchError)
    expect((error as LimitedFetchError).code).toBe('timeout')
  })

  it('응답 바이트가 maxResponseBytes를 넘으면 절단 없이 실패하고 상위 읽기를 중단한다', async () => {
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => {
      const source = streamOf(['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(10)])
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const reader = source.getReader()
          const { value, done } = await reader.read()
          reader.releaseLock()
          if (done) controller.close(); else controller.enqueue(value)
        },
        cancel,
      })
      return new Response(body, { status: 200 })
    }))
    const response = await limitedFetch('https://upstream.example/v1/models', {}, { maxResponseBytes: 25 })
    const error = await response.text().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LimitedFetchError)
    expect((error as LimitedFetchError).code).toBe('response_too_large')
    expect(cancel).toHaveBeenCalled()
  })

  it('상한 이내 응답은 그대로 전달한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamOf(['{"data":', '[{"id":"m"}]}']), { status: 200, headers: { 'content-type': 'application/json' } })))
    const response = await limitedFetch('https://upstream.example/v1/models', {}, { maxResponseBytes: 64, timeoutMs: 1000 })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ data: [{ id: 'm' }] })
  })

  it('외부 signal 취소는 aborted로 구분한다', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    const controller = new AbortController()
    const pending = limitedFetch('https://upstream.example/v1/chat/completions', { method: 'POST' }, { signal: controller.signal, timeoutMs: 5000 })
    controller.abort()
    const error = await pending.catch((e: unknown) => e)
    expect((error as LimitedFetchError).code).toBe('aborted')
  })

  it('네트워크 예외는 상위 메시지를 버리고 고정 문구만 남긴다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED top-secret https://upstream.example') }))
    const error = await limitedFetch('https://upstream.example/v1/models').catch((e: unknown) => e)
    expect((error as LimitedFetchError).code).toBe('network')
    expect((error as Error).message).toBe(LIMITED_FETCH_MESSAGES.network)
    expect((error as Error).message).not.toContain('top-secret')
  })

  it('toLimitedFetchError는 AbortError·기타 예외를 안전한 오류로 바꾼다', () => {
    expect(toLimitedFetchError(new DOMException('x', 'AbortError')).code).toBe('aborted')
    expect(toLimitedFetchError(new Error('Bearer top-secret')).code).toBe('network')
    const own = new LimitedFetchError('timeout')
    expect(toLimitedFetchError(own)).toBe(own)
  })
})
