import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, win32 } from 'node:path'
import { isOutsideApp, loadConfig } from './config.js'

const roots: string[] = []
function tempRoot() {
  const root = mkdtempSync(resolve(tmpdir(), 'mes-config-'))
  roots.push(root)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const base = {
  DATABASE_URL: 'mysql://u:p@localhost:3306/db',
  SESSION_SECRET: 'x'.repeat(32),
  APP_ORIGIN: 'http://localhost:5173',
  OIDC_ISSUER: 'http://localhost:8180/realms/mes-dev',
  OIDC_CLIENT_ID: 'mes-agent-hub',
  OIDC_CLIENT_SECRET: 'secret',
}

describe('loadConfig', () => {
  it('URL_AUTO_FETCH는 기본 true이고 false일 때만 꺼진다', () => {
    expect(loadConfig(base).urlAutoFetch).toBe(true)
    expect(loadConfig({ ...base, URL_AUTO_FETCH: 'false' }).urlAutoFetch).toBe(false)
    expect(() => loadConfig({ ...base, URL_AUTO_FETCH: 'yes' })).toThrow(/URL_AUTO_FETCH/)
  })
  it('추가 출처는 선택이며 기본 출처만으로도 동작한다', () => {
    expect(loadConfig(base).allowedOrigins).toEqual([base.APP_ORIGIN])
    expect(loadConfig({ ...base, APP_EXTRA_ORIGINS: ' , , ' }).allowedOrigins).toEqual([base.APP_ORIGIN])
  })

  it('출처의 대소문자·기본 포트·마지막 슬래시를 정규화하고 중복을 제거한다', () => {
    const c = loadConfig({ ...base, APP_ORIGIN: 'HTTPS://Hub.Example.com:443/',
      APP_EXTRA_ORIGINS: ' https://HUB.example.com, http://Alias.example.com:80/, https://alias.example.com:8443, http://[::1]:8080 ' })
    expect(c.appOrigin).toBe('https://hub.example.com')
    expect(c.allowedOrigins).toEqual(['https://hub.example.com', 'http://alias.example.com', 'https://alias.example.com:8443', 'http://[::1]:8080'])
  })

  it.each([
    '*', 'https://*.example.com', 'https://%2a.example.com', 'https://example.com/*',
    'https://example.com/path', 'https://example.com/path/..', 'https://example.com/?q=1',
    'https://example.com/#fragment', 'https://user:password@example.com', 'null',
    'example.com', 'ftp://example.com', 'file:///tmp', 'https://example.com:99999',
    'https://example.com\\path', 'https://exam\tple.com',
  ])('잘못된 추가 출처 %s는 기동 시 거부한다', (origin) => {
    expect(() => loadConfig({ ...base, APP_EXTRA_ORIGINS: `https://valid.example.com, ${origin}` })).toThrow(/APP_EXTRA_ORIGINS/)
  })

  it.each(['http://hub.example.com', 'https://hub.example.com'])('추가 출처의 프로토콜과 무관하게 %s 기준으로 OIDC·Secure 쿠키를 설정한다', (origin) => {
    const c = loadConfig({ ...base, AUTH_MODE: 'oidc', APP_ORIGIN: origin,
      APP_EXTRA_ORIGINS: 'http://alias.example.com, https://secure.example.com' })
    expect(c.appOrigin).toBe(origin)
    expect(c.cookieSecure).toBe(origin.startsWith('https://'))
    expect(c.oidc?.redirectUri).toBe(`${origin}/api/auth/callback`)
  })

  it('기본 이메일 도메인은 선택이며 빈 설정은 사용하지 않는다', () => {
    expect(loadConfig(base).defaultEmailDomain).toBeUndefined()
    expect(loadConfig({ ...base, DEFAULT_EMAIL_DOMAIN: '' }).defaultEmailDomain).toBeUndefined()
    expect(loadConfig({ ...base, DEFAULT_EMAIL_DOMAIN: ' example.com ' }).defaultEmailDomain).toBe('example.com')
    for (const domain of ['a@example.com', 'https://example.com', 'example.com/path']) expect(() => loadConfig({ ...base, DEFAULT_EMAIL_DOMAIN: domain })).toThrow(/DEFAULT_EMAIL_DOMAIN/)
  })
  it.each(['example-.com', '-example.com', `${'a'.repeat(64)}.com`, 'example..com', 'exam_ple.com', `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`])('잘못된 기본 이메일 도메인 %s는 기동 시 설정 오류를 낸다', (domain) => {
    expect(() => loadConfig({ ...base, DEFAULT_EMAIL_DOMAIN: domain })).toThrow(/설정 오류 — DEFAULT_EMAIL_DOMAIN:/)
  })
  it.each(['a.co', 'EXAMPLE.COM', 'my-company.example.com', `${'a'.repeat(63)}.com`, `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`])('유효한 기본 이메일 도메인 %s는 허용한다', (domain) => {
    expect(loadConfig({ ...base, DEFAULT_EMAIL_DOMAIN: domain }).defaultEmailDomain).toBe(domain)
  })
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

  it('env 파일이 없으면 실행 폴더와 무관하게 저장소 루트를 쓴다', () => {
    const appRoot = resolve(import.meta.dirname, '../../../..')
    for (const cwd of [appRoot, resolve(appRoot, 'apps/api'), tmpdir()]) {
      const c = loadConfig({ ...base, FILE_STORAGE_ROOT: 'storage', WEB_DIST_DIR: './public' }, { cwd, execArgv: [] })
      expect(c.fileStorageRoot).toBe(resolve(appRoot, 'storage'))
      expect(c.webDistDir).toBe(resolve(appRoot, 'public'))
      expect(c.fileStorageResolution).toEqual({ configuredPath: 'storage', baseDir: appRoot, envFile: null })
    }
  })

  it.each(['--env-file', '--env-file-if-exists'])('%s의 실제 env 폴더를 기준으로 상대 경로를 푼다', (flag) => {
    const root = tempRoot()
    mkdirSync(resolve(root, 'config'))
    writeFileSync(resolve(root, 'config/.env'), 'FILE_STORAGE_ROOT=./storage\n')
    for (const cwd of [root, resolve(root, 'apps/api')]) {
      const file = resolve(root, 'config/.env')
      for (const execArgv of [[`${flag}=${file}`], [flag, file]]) {
        const c = loadConfig({ ...base, FILE_STORAGE_ROOT: './storage', WEB_DIST_DIR: 'public', HTTPS_CERT_FILE: 'tls/cert.pem', HTTPS_KEY_FILE: 'tls/key.pem' }, { cwd, execArgv, appRoot: root })
        expect(c.fileStorageRoot).toBe(resolve(root, 'config/storage'))
        expect(c.webDistDir).toBe(resolve(root, 'config/public'))
        expect(c.https).toEqual({ certFile: resolve(root, 'config/tls/cert.pem'), keyFile: resolve(root, 'config/tls/key.pem'), caFile: undefined })
        expect(c.fileStorageResolution).toEqual({ configuredPath: './storage', baseDir: resolve(root, 'config'), envFile: file })
      }
    }
    const c = loadConfig(base, { cwd: resolve(root, 'apps/api'), execArgv: ['--env-file-if-exists=../../config/.env'], appRoot: root })
    expect(c.fileStorageRoot).toBe(resolve(root, 'config/storage'))
  })

  it('없는 선택적 env 파일은 기준과 운영 규칙에 영향을 주지 않는다', () => {
    const root = tempRoot()
    writeFileSync(resolve(root, '.env'), '')
    const c = loadConfig(base, { cwd: root, appRoot: root, execArgv: ['--env-file=.env', '--env-file-if-exists=../missing.env'] })
    expect(c.fileStorageRoot).toBe(resolve(root, 'storage'))
    expect(c.fileStorageResolution.envFile).toBe(resolve(root, '.env'))
    expect(loadConfig(base, { cwd: tmpdir(), execArgv: ['--env-file-if-exists=missing.env'] }).fileStorageRoot)
      .toBe(resolve(import.meta.dirname, '../../../../storage'))
  })

  it('절대 경로는 env 기준을 덧붙이지 않는다', () => {
    const c = loadConfig({ ...base, FILE_STORAGE_ROOT: tmpdir(), WEB_DIST_DIR: tmpdir() })
    expect(c.fileStorageRoot).toBe(resolve(tmpdir()))
    expect(c.webDistDir).toBe(resolve(tmpdir()))
    expect(c.fileStorageResolution.baseDir).toBeNull()
  })

  it('Windows 드라이브·UNC 경로와 상대 경로를 Windows 기준으로 푼다', () => {
    const options = { cwd: 'D:\\work', appRoot: 'C:\\mes-hub\\app', execArgv: ['--env-file=C:\\mes-hub\\app\\config\\.env'], pathApi: win32, fileExists: () => true }
    expect(loadConfig({ ...base, FILE_STORAGE_ROOT: 'storage' }, options).fileStorageRoot).toBe('C:\\mes-hub\\app\\config\\storage')
    for (const path of ['D:\\storage', '\\\\server\\share\\storage']) {
      expect(loadConfig({ ...base, NODE_ENV: 'production', FILE_STORAGE_ROOT: path }, options).fileStorageRoot).toBe(path)
    }
    expect(() => loadConfig({ ...base, FILE_STORAGE_ROOT: 'D:storage' }, options)).toThrow(/FILE_STORAGE_ROOT/)
  })

  it('운영 환경은 app 안이나 상대 경로의 파일 저장소를 거부한다', () => {
    const app = resolve(import.meta.dirname, '../../../..')
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', FILE_STORAGE_ROOT: './storage' })).toThrow(/FILE_STORAGE_ROOT/)
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', FILE_STORAGE_ROOT: `${app}/storage` })).toThrow(/FILE_STORAGE_ROOT/)
    expect(loadConfig({ ...base, NODE_ENV: 'production', FILE_STORAGE_ROOT: resolve(app, '..', 'mes-hub-storage') }).fileStorageRoot).toBe(resolve(app, '..', 'mes-hub-storage'))
  })

  it.each(['--env-file', '--env-file-if-exists'])('app 밖의 %s는 운영 파일 저장소 규칙을 적용한다', (flag) => {
    const root = tempRoot()
    mkdirSync(resolve(root, 'app'))
    writeFileSync(resolve(root, '.env'), '')
    for (const execArgv of [[`${flag}=../.env`], [flag, '../.env']]) {
      const options = { cwd: resolve(root, 'app'), appRoot: resolve(root, 'app'), execArgv }
      expect(() => loadConfig({ ...base, FILE_STORAGE_ROOT: './storage' }, options)).toThrow(/FILE_STORAGE_ROOT/)
      expect(() => loadConfig({ ...base, FILE_STORAGE_ROOT: resolve(root, 'app/storage') }, options)).toThrow(/FILE_STORAGE_ROOT/)
      expect(loadConfig({ ...base, FILE_STORAGE_ROOT: resolve(root, 'storage') }, options).fileStorageRoot).toBe(resolve(root, 'storage'))
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
    expect(loadConfig(base).llm).toEqual({ mode: 'mock', preset: 'openwebui', baseUrl: '', apiKey: '', defaultModel: undefined, owuiMode: 'auto', owuiCleanup: true })
    expect(() => loadConfig({ ...base, LLM_MODE: 'live' })).toThrow(/LLM_BASE_URL.*LLM_API_KEY/)
    expect(() => loadConfig({ ...base, LLM_MODE: 'live', LLM_BASE_URL: 'invalid', LLM_API_KEY: 'secret' })).toThrow(/LLM_BASE_URL/)
    expect(() => loadConfig({ ...base, LLM_MODE: 'live', LLM_BASE_URL: 'http://localhost:3101/api', LLM_API_KEY: 'secret' })).toThrow(/LLM_BASE_URL/)
    expect(loadConfig({ ...base, LLM_MODE: 'live', LLM_PRESET: 'openai-compatible', LLM_BASE_URL: 'https://api.openai.com/v1', LLM_API_KEY: 'secret' }).llm.preset).toBe('openai-compatible')
  })
})

it('OpenWebUI 세션 모드 기본값은 auto·정리 켬이고 env로 바꾼다 (S12)', () => {
  expect(loadConfig({ ...base, LLM_OWUI_MODE: 'direct', LLM_OWUI_CLEANUP: 'false' }).llm).toMatchObject({ owuiMode: 'direct', owuiCleanup: false })
  expect(loadConfig({ ...base, LLM_OWUI_MODE: 'session', LLM_OWUI_CLEANUP: 'true' }).llm).toMatchObject({ owuiMode: 'session', owuiCleanup: true })
  expect(() => loadConfig({ ...base, LLM_OWUI_MODE: 'socket' })).toThrow(/LLM_OWUI_MODE/)
  expect(() => loadConfig({ ...base, LLM_OWUI_CLEANUP: 'yes' })).toThrow(/LLM_OWUI_CLEANUP/)
})

it('defaults chat waits to minutes and preserves explicit environment values', () => {
  expect(loadConfig(base).request).toMatchObject({ firstTokenMs: 300_000, filesFirstTokenMs: 600_000, idleMs: 300_000, maxMs: 1_800_000 })
  expect(loadConfig({ ...base, REQUEST_FIRST_TOKEN_MS: '60000', REQUEST_FILES_FIRST_TOKEN_MS: '360000', REQUEST_IDLE_MS: '12345', REQUEST_MAX_MS: '600000' }).request)
    .toMatchObject({ firstTokenMs: 60_000, filesFirstTokenMs: 360_000, idleMs: 12_345, maxMs: 600_000 })
})
