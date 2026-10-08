import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse } from '@/test/render'
import { LlmTestError, testChat, testConnection } from './llm'

afterEach(() => vi.unstubAllGlobals())

describe('llm api client', () => {
  it('testChat은 POST로 보내고 결과를 검증한다', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { text: '답', model: 'm', ms: 3 }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    expect(await testChat({ model: 'm', messages: [{ role: 'user', content: '질문' }] }, controller.signal)).toEqual({ text: '답', model: 'm', ms: 3 })
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/llm/test', expect.objectContaining({ method: 'POST', credentials: 'same-origin', signal: controller.signal, body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: '질문' }] }) }))
  })
  it('실패는 상태 코드와 분류 코드를 가진 LlmTestError다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(504, { message: '응답 시간 초과', code: 'TIMEOUT' })))
    const error = await testChat({ messages: [{ role: 'user', content: 'x' }] }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmTestError)
    expect(error).toMatchObject({ status: 504, code: 'TIMEOUT', message: '응답 시간 초과' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>413</html>', { status: 413 })))
    expect(await testChat({ messages: [{ role: 'user', content: 'x' }] }).catch((e: unknown) => e)).toMatchObject({ status: 413, code: undefined })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { text: 1 })))
    await expect(testChat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow()
  })
  it('testConnection은 두 결과를 검증해 돌려주고 실패 상태는 LlmTestError다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { models: { ok: true, count: 1, ms: 2 }, completion: { ok: false, ms: 3, model: 'm', error: 'HTTP 500' } })))
    expect(await testConnection()).toEqual({ models: { ok: true, count: 1, ms: 2 }, completion: { ok: false, ms: 3, model: 'm', error: 'HTTP 500' } })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, { message: 'Forbidden' })))
    await expect(testConnection()).rejects.toMatchObject({ status: 403 })
  })
})
