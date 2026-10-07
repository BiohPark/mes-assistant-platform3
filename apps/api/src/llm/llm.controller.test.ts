import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { OpenAICompatibleProvider, type ChatProvider } from '@mes/llm'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { SESSION_STORE, type SessionStore } from '../auth/session.service.js'
import { LLM_PROVIDER } from './llm.controller.js'
import { toLlmSettings } from './presets.js'

const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', LLM_MODE: 'live', LLM_BASE_URL: 'http://localhost:3101', LLM_API_KEY: 'top-secret' })
const sessions: SessionStore = {
  create: vi.fn(async () => ({ token: '', expiresAt: new Date() })),
  resolve: vi.fn(async (token: string) => token === 'owner' ? { id: 'o', name: 'Owner', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: true } : token === 'member' ? { id: 'm', name: 'Member', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: false } : null),
  destroy: vi.fn(async () => undefined),
}

describe('LLM API', () => {
  let app: INestApplication
  const listModels = vi.fn(async () => ['fake-general'])
  const ping = vi.fn(async () => ({ ok: true, detail: '연결 성공' }))
  beforeEach(async () => {
    const provider = { kind: 'live', listModels, ping } as unknown as ChatProvider
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(SESSION_STORE).useValue(sessions)
      .overrideProvider(LLM_PROVIDER).useValue(provider)
      .compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.init()
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks(); vi.unstubAllGlobals() })

  it('로그인 사용자에게 모델 목록을 반환하고 60초 캐시를 사용한다', async () => {
    await request(app.getHttpServer()).get('/api/llm/models').expect(401)
    await request(app.getHttpServer()).get('/api/llm/models').set('Cookie', 'mes_session=member').expect(200, { models: ['fake-general'] })
    await request(app.getHttpServer()).get('/api/llm/models').set('Cookie', 'mes_session=owner').expect(200, { models: ['fake-general'] })
    expect(listModels).toHaveBeenCalledTimes(1)
  })
  it('SO만 상태를 볼 수 있고 경로나 키를 응답하지 않는다', async () => {
    await request(app.getHttpServer()).get('/api/llm/status').set('Cookie', 'mes_session=member').expect(403)
    const res = await request(app.getHttpServer()).get('/api/llm/status').set('Cookie', 'mes_session=owner').expect(200)
    expect(res.body).toEqual({ mode: 'live', preset: 'openwebui', baseUrlHost: 'localhost:3101', ok: true, detail: '연결 성공' })
    expect(JSON.stringify(res.body)).not.toContain('top-secret')
  })
  it('상위 모델 조회 실패는 비밀을 숨긴 502로 반환한다', async () => {
    listModels.mockRejectedValueOnce(new Error('Authorization: Bearer top-secret'))
    const res = await request(app.getHttpServer()).get('/api/llm/models').set('Cookie', 'mes_session=member').expect(502)
    expect(JSON.stringify(res.body)).not.toMatch(/top-secret|Authorization|Bearer/)
    expect(res.body.message).toMatch(/모델 목록/)
  })
  it('실제 provider의 상위 HTTP 500은 비밀 없는 502로 반환한다', async () => {
    await app.close()
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(SESSION_STORE).useValue(sessions)
      .overrideProvider(LLM_PROVIDER).useValue(new OpenAICompatibleProvider(toLlmSettings(config.llm)))
      .compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.init()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('top-secret http://localhost:3101/api/models', { status: 500 })))
    const res = await request(app.getHttpServer()).get('/api/llm/models').set('Cookie', 'mes_session=member').expect(502)
    expect(res.body.message).toMatch(/모델 목록/)
    expect(JSON.stringify(res.body)).not.toMatch(/top-secret|localhost:3101|Authorization|Bearer/)
  })
})
