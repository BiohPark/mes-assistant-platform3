import 'reflect-metadata'
import { Module, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
    writeFileSync(join(dist, 'assets', 'x-12345678.js'), 'window.x = 1')
    writeFileSync(join(dist, 'assets', 'plain.js'), 'window.plain = 1')
    const client = await start(dist)
    for (const path of ['/', '/c/abc']) {
      const response = await client.get(path).expect(200)
      expect(response.text).toBe('<h1>web</h1>')
      expect(response.headers['cache-control']).toBe('no-cache')
    }
    const asset = await client.get('/assets/x-12345678.js').expect(200)
    expect(asset.headers['cache-control']).toMatch(/max-age=31536000/)
    expect(asset.text).toBe('window.x = 1')
    const plain = await client.get('/assets/plain.js').expect(200)
    expect(plain.headers['cache-control']).toBe('no-cache')
    const missingApi = await client.get('/api/missing').expect(404)
    expect(missingApi.headers['content-type']).toMatch(/json/)
  })

  it('공통 보안 헤더와 index CSP를 제공한다', async () => {
    const client = await start(dist)
    const page = await client.get('/c/abc').expect(200)
    expect(page.headers['x-content-type-options']).toBe('nosniff')
    expect(page.headers['referrer-policy']).toBe('same-origin')
    expect(page.headers['x-frame-options']).toBe('DENY')
    expect(page.headers['content-security-policy']).toContain("default-src 'self'")
    const api = await client.get('/api/missing').expect(404)
    expect(api.headers['x-content-type-options']).toBe('nosniff')
  })

  it('동기 프로필 스크립트를 같은 출처에서 제공하고 index의 CSP는 self만 허용한다', async () => {
    const html = readFileSync(join(import.meta.dirname, '../../web/index.html'), 'utf8')
    const scriptPath = html.match(/<script\b[^>]*\bid="profile-cache"[^>]*\bsrc="([^"]+)"/)?.[1]
    expect(scriptPath).toBe('/profile-cache.js')
    const script = readFileSync(join(import.meta.dirname, '../../web/public/profile-cache.js'), 'utf8')
    writeFileSync(join(dist, 'index.html'), html)
    writeFileSync(join(dist, 'profile-cache.js'), script)
    const client = await start(dist)
    for (const path of ['/', '/my-info']) {
      const page = await client.get(path).expect(200)
      expect(page.text).toBe(html)
      expect(page.headers['content-security-policy'].split(';').map((directive: string) => directive.trim()))
        .toContain("script-src 'self'")
    }
    const asset = await client.get(scriptPath!).expect(200)
    expect(asset.headers['content-type']).toMatch(/javascript/)
    expect(asset.headers['x-content-type-options']).toBe('nosniff')
    expect(asset.headers['cache-control']).toBe('no-cache')
    expect(asset.text).toBe(script)
  })

  it('인코딩된 상위 경로를 차단한다', async () => {
    const client = await start(dist)
    await client.get('/..%2f..%2fetc').expect(400)
    await client.get('/%2e%2e/index.html').expect(400)
  })

  it('web 루트가 심볼릭 링크여도 내부 파일을 제공한다', async (context) => {
    const linkedDist = join(root, 'linked-dist')
    writeFileSync(join(dist, 'assets', 'plain.js'), 'window.plain = 1')
    try { symlinkSync(dist, linkedDist, process.platform === 'win32' ? 'junction' : 'dir') }
    catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') { context.skip(); return }
      throw error
    }
    const client = await start(linkedDist)
    expect((await client.get('/').expect(200)).text).toBe('<h1>web</h1>')
    expect((await client.get('/assets/plain.js').expect(200)).text).toBe('window.plain = 1')
  })

  it('web 폴더 밖을 가리키는 링크를 제공하지 않는다', async (context) => {
    const secret = join(root, 'secret.txt')
    writeFileSync(secret, 'secret')
    try { symlinkSync(secret, join(dist, 'assets', 'linked.txt')) }
    catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') { context.skip(); return }
      throw error
    }
    const client = await start(dist)
    await client.get('/assets/linked.txt').expect(403)
  })

  it('web 폴더가 없으면 정적 제공을 끈다', async () => {
    const client = await start(join(root, 'missing'))
    await client.get('/').expect(404)
  })
})
