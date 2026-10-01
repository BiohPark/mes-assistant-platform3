import 'reflect-metadata'
import { Module, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureApp } from './app.factory.js'
import { SESSION_STORE } from './auth/session.service.js'
import { loadConfig } from './config/config.js'

@Module({ providers: [{ provide: SESSION_STORE, useValue: { resolve: async () => null } }] })
class StaticTestModule {}

describe('web 정적 제공', () => {
  const root = mkdtempSync(join(tmpdir(), 'mes-web-'))
  const dist = join(root, 'dist')
  let app: INestApplication | undefined

  beforeEach(() => {
    mkdirSync(join(dist, 'assets'), { recursive: true })
    writeFileSync(join(dist, 'index.html'), '<h1>web</h1>')
  })
  afterEach(async () => { await app?.close(); app = undefined; rmSync(root, { recursive: true, force: true }) })

  async function start(webDistDir: string) {
    const config = loadConfig({
      DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32),
      APP_ORIGIN: 'http://localhost:3000', WEB_DIST_DIR: webDistDir,
    })
    const moduleRef = await Test.createTestingModule({ imports: [StaticTestModule] }).compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.init()
    return request(app.getHttpServer())
  }

  it('루트와 SPA 경로는 index, 자산은 장기 캐시, API 미등록 경로는 JSON 404', async () => {
    writeFileSync(join(dist, 'assets', 'x.js'), 'window.x = 1')
    const client = await start(dist)
    for (const path of ['/', '/c/abc']) {
      const response = await client.get(path).expect(200)
      expect(response.text).toBe('<h1>web</h1>')
      expect(response.headers['cache-control']).toBe('no-cache')
    }
    const asset = await client.get('/assets/x.js').expect(200)
    expect(asset.headers['cache-control']).toMatch(/max-age=31536000/)
    expect(asset.text).toBe('window.x = 1')
    const missingApi = await client.get('/api/missing').expect(404)
    expect(missingApi.headers['content-type']).toMatch(/json/)
  })

  it('인코딩된 상위 경로를 차단한다', async () => {
    const client = await start(dist)
    await client.get('/..%2f..%2fetc').expect(400)
    await client.get('/%2e%2e/index.html').expect(400)
  })

  it('web 폴더가 없으면 정적 제공을 끈다', async () => {
    const client = await start(join(root, 'missing'))
    await client.get('/').expect(404)
  })
})
