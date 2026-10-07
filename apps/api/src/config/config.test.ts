import { describe, expect, it } from 'vitest'
import { resolve, win32 } from 'node:path'
import { isOutsideApp, loadConfig } from './config.js'

const base = {
  DATABASE_URL: 'mysql://u:p@localhost:3306/db',
  SESSION_SECRET: 'x'.repeat(32),
  APP_ORIGIN: 'http://localhost:5173',
  OIDC_ISSUER: 'http://localhost:8180/realms/mes-dev',
  OIDC_CLIENT_ID: 'mes-agent-hub',
  OIDC_CLIENT_SECRET: 'secret',
}

describe('loadConfig', () => {
  it('기본값을 채우고 목록형 값을 나눈다', () => {
    const c = loadConfig({ ...base, AUTH_MODE: 'oidc', INITIAL_SYSTEM_OWNERS: ' dev-owner , other ,' })
    expect(c.port).toBe(3000)
    expect(c.initialSystemOwners).toEqual(['dev-owner', 'other'])
    expect(c.oidc?.redirectUri).toBe('http://localhost:5173/api/auth/callback')
    expect(c.cookieSecure).toBe(false)
    expect(c.sessionTtlHours).toBe(12)
    expect(c.sessionIdleHours).toBe(12)
    expect(c.request.maxActive).toBe(20)
    expect(c.authAttempts).toEqual({ max: 10, windowMs: 600_000, ipPendingMax: 100 })
    expect(c.trustProxy).toBe(false)
    expect(c.fileMaxBytes).toBe(50 * 1024 * 1024)
    expect(c.fileMaxPerRequest).toBe(20)
  })

  it('TRUST_PROXY는 false, 홉 수, IP/서브넷 목록만 허용한다', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).trustProxy).toBe(1)
    expect(loadConfig({ ...base, TRUST_PROXY: '127.0.0.1, 10.0.0.0/8' }).trustProxy).toEqual(['127.0.0.1', '10.0.0.0/8'])
    expect(loadConfig({ ...base, TRUST_PROXY: 'false' }).trustProxy).toBe(false)
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/)
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/)
  })

  it('기본 local 모드는 OIDC 설정 없이 시작한다', () => {
    const { OIDC_ISSUER: _issuer, OIDC_CLIENT_ID: _id, OIDC_CLIENT_SECRET: _secret, ...local } = base
    const c = loadConfig(local)
    expect(c.authMode).toBe('local')
    expect(c.oidc).toBeUndefined()
  })

  it('oidc 모드에는 모든 OIDC 설정이 필요하다', () => {
    expect(() => loadConfig({ ...base, AUTH_MODE: 'oidc', OIDC_ISSUER: undefined })).toThrow(/OIDC_ISSUER/)
    expect(() => loadConfig({ ...base, AUTH_MODE: 'oidc', OIDC_CLIENT_ID: undefined })).toThrow(/OIDC_CLIENT_ID/)
    expect(() => loadConfig({ ...base, AUTH_MODE: 'oidc', OIDC_CLIENT_SECRET: undefined })).toThrow(/OIDC_CLIENT_SECRET/)
  })

  it('https 앱 주소면 Secure 쿠키', () => {
    expect(loadConfig({ ...base, APP_ORIGIN: 'https://hub.example.com/' }).cookieSecure).toBe(true)
  })

  it('비기능 설정은 유효한 양수로 조정한다', () => {
    const c = loadConfig({ ...base, SESSION_IDLE_HOURS: '2', REQUEST_MAX_ACTIVE: '3', AUTH_ATTEMPT_MAX: '4', AUTH_ATTEMPT_WINDOW_MS: '1000' })
    expect(c.sessionIdleHours).toBe(2)
    expect(c.request.maxActive).toBe(3)
    expect(c.authAttempts).toEqual({ max: 4, windowMs: 1000, ipPendingMax: 100 })
    expect(() => loadConfig({ ...base, REQUEST_MAX_ACTIVE: '0' })).toThrow(/REQUEST_MAX_ACTIVE/)
    expect(loadConfig({ ...base, AUTH_IP_PENDING_MAX: '25' }).authAttempts.ipPendingMax).toBe(25)
    expect(() => loadConfig({ ...base, AUTH_IP_PENDING_MAX: '0' })).toThrow(/AUTH_IP_PENDING_MAX/)
  })

  it('필수 값이 없거나 세션 비밀이 짧으면 어떤 키인지 알려 준다', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/)
  })

  it('파일 저장 루트는 절대 경로로 풀어 둔다 (Windows 드라이브·UNC도 path.resolve가 처리)', () => {
    const c = loadConfig({ ...base, FILE_STORAGE_ROOT: 'storage' })
    expect(c.fileStorageRoot).toBe(resolve('storage'))
  })

  it('운영 환경은 app 안이나 상대 경로의 파일 저장소를 거부한다', () => {
    const app = process.cwd()
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', FILE_STORAGE_ROOT: './storage' })).toThrow(/FILE_STORAGE_ROOT/)
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', FILE_STORAGE_ROOT: `${app}/storage` })).toThrow(/FILE_STORAGE_ROOT/)
    expect(loadConfig({ ...base, NODE_ENV: 'production', FILE_STORAGE_ROOT: resolve(app, '..', 'mes-hub-storage') }).fileStorageRoot).toBe(resolve(app, '..', 'mes-hub-storage'))
  })

  it('app 밖의 설정 파일을 쓰면 NODE_ENV 없이도 운영 파일 저장소 규칙을 적용한다', () => {
    for (const args of [['--env-file=../config/.env'], ['--env-file', '../config/.env']]) {
      process.execArgv.push(...args)
      try { expect(() => loadConfig({ ...base, FILE_STORAGE_ROOT: './storage' })).toThrow(/FILE_STORAGE_ROOT/) }
      finally { process.execArgv.splice(-args.length) }
    }
  })

  it('Windows에서는 다른 드라이브와 UNC 공유를 app 밖으로 인정한다', () => {
    const app = 'C:\\mes-hub\\app'
    expect(isOutsideApp(app, 'D:\\mes-hub\\storage', win32)).toBe(true)
    expect(isOutsideApp(app, '\\\\server\\share\\storage', win32)).toBe(true)
    expect(isOutsideApp(app, 'C:\\mes-hub\\storage', win32)).toBe(true)
    expect(isOutsideApp(app, 'C:\\mes-hub\\app\\storage', win32)).toBe(false)
    expect(isOutsideApp(app, app, win32)).toBe(false)
  })

  it('LLM은 기본적으로 mock이며 live에는 URL과 키가 필요하다', () => {
    expect(loadConfig(base).llm).toEqual({ mode: 'mock', preset: 'openwebui', baseUrl: '', apiKey: '', defaultModel: undefined })
    expect(() => loadConfig({ ...base, LLM_MODE: 'live' })).toThrow(/LLM_BASE_URL.*LLM_API_KEY/)
    expect(() => loadConfig({ ...base, LLM_MODE: 'live', LLM_BASE_URL: 'invalid', LLM_API_KEY: 'secret' })).toThrow(/LLM_BASE_URL/)
    expect(() => loadConfig({ ...base, LLM_MODE: 'live', LLM_BASE_URL: 'http://localhost:3101/api', LLM_API_KEY: 'secret' })).toThrow(/LLM_BASE_URL/)
    expect(loadConfig({ ...base, LLM_MODE: 'live', LLM_PRESET: 'openai-compatible', LLM_BASE_URL: 'https://api.openai.com/v1', LLM_API_KEY: 'secret' }).llm.preset).toBe('openai-compatible')
  })
})
