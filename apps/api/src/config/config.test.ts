import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  SESSION_SECRET: 'x'.repeat(32),
  APP_ORIGIN: 'http://localhost:5173',
  OIDC_ISSUER: 'http://localhost:8180/realms/mes-dev',
  OIDC_CLIENT_ID: 'mes-agent-hub',
  OIDC_CLIENT_SECRET: 'secret',
}

describe('loadConfig', () => {
  it('기본값을 채우고 목록형 값을 나눈다', () => {
    const c = loadConfig({ ...base, INITIAL_SYSTEM_OWNERS: ' dev-owner , other ,' })
    expect(c.port).toBe(3000)
    expect(c.initialSystemOwners).toEqual(['dev-owner', 'other'])
    expect(c.oidc.redirectUri).toBe('http://localhost:5173/api/auth/callback')
    expect(c.cookieSecure).toBe(false)
    expect(c.sessionTtlHours).toBe(12)
  })

  it('https 앱 주소면 Secure 쿠키', () => {
    expect(loadConfig({ ...base, APP_ORIGIN: 'https://hub.example.com/' }).cookieSecure).toBe(true)
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
})
