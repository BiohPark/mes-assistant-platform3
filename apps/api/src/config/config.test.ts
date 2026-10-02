import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

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
    expect(c.authAttempts).toEqual({ max: 10, windowMs: 600_000 })
    expect(c.trustProxy).toBe(false)
    expect(c.fileMaxBytes).toBe(50 * 1024 * 1024)
    expect(c.fileMaxPerRequest).toBe(20)
  })

  it('TRUST_PROXY는 명시적으로 켜야 한다', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true)
    expect(loadConfig({ ...base, TRUST_PROXY: 'false' }).trustProxy).toBe(false)
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
    expect(c.authAttempts).toEqual({ max: 4, windowMs: 1000 })
    expect(() => loadConfig({ ...base, REQUEST_MAX_ACTIVE: '0' })).toThrow(/REQUEST_MAX_ACTIVE/)
  })

  it('필수 값이 없거나 세션 비밀이 짧으면 어떤 키인지 알려 준다', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/)
  })

  it('파일 저장 루트는 절대 경로로 풀어 둔다 (Windows 드라이브·UNC도 path.resolve가 처리)', () => {
    const c = loadConfig({ ...base, FILE_STORAGE_ROOT: 'storage' })
    expect(c.fileStorageRoot).toMatch(/storage$/)
    expect(c.fileStorageRoot).not.toBe('storage')
  })

  it('LLM은 기본적으로 mock이며 live에는 URL과 키가 필요하다', () => {
    expect(loadConfig(base).llm).toEqual({ mode: 'mock', preset: 'openwebui', baseUrl: '', apiKey: '', defaultModel: undefined })
    expect(() => loadConfig({ ...base, LLM_MODE: 'live' })).toThrow(/LLM_BASE_URL.*LLM_API_KEY/)
    expect(() => loadConfig({ ...base, LLM_MODE: 'live', LLM_BASE_URL: 'invalid', LLM_API_KEY: 'secret' })).toThrow(/LLM_BASE_URL/)
    expect(() => loadConfig({ ...base, LLM_MODE: 'live', LLM_BASE_URL: 'http://localhost:3101/api', LLM_API_KEY: 'secret' })).toThrow(/LLM_BASE_URL/)
    expect(loadConfig({ ...base, LLM_MODE: 'live', LLM_PRESET: 'openai-compatible', LLM_BASE_URL: 'https://api.openai.com/v1', LLM_API_KEY: 'secret' }).llm.preset).toBe('openai-compatible')
  })
})
