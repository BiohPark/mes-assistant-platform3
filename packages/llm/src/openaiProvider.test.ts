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
