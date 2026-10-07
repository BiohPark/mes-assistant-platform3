import { isAbsolute, relative, resolve, sep } from 'node:path'
import { isIP } from 'node:net'
import { z } from 'zod'
import { AuthModeSchema, FILE_MAX_PER_REQUEST } from '@mes/contracts'

const list = z
  .string()
  .default('')
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))

function isOriginUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password
  } catch { return false }
}

function parseTrustProxy(value: string): false | number | string[] | undefined {
  if (value === 'false') return false
  if (/^(0|[1-9]\d*)$/.test(value)) {
    const hops = Number(value)
    return Number.isSafeInteger(hops) ? hops : undefined
  }
  const addresses = value.split(',').map((address) => address.trim())
  if (addresses.every((address) => {
    const [ip, prefix, extra] = address.split('/')
    const version = isIP(ip ?? '')
    return !extra && version !== 0 && (prefix === undefined || /^\d+$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128))
  })) return addresses
  return undefined
}

const EnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET은 32자 이상'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  SESSION_IDLE_HOURS: z.coerce.number().positive().default(12),
  AUTH_ATTEMPT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_ATTEMPT_WINDOW_MS: z.coerce.number().int().positive().default(600_000),
  AUTH_IP_PENDING_MAX: z.coerce.number().int().positive().default(100),
  TRUST_PROXY: z.string().default('false').transform(parseTrustProxy).refine((value) => value !== undefined, 'TRUST_PROXY는 false, 홉 수 또는 IP/서브넷 목록이어야 합니다'),
  AUTH_MODE: AuthModeSchema.default('local'),
  OIDC_ISSUER: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  INITIAL_SYSTEM_OWNERS: list,
  FILE_STORAGE_ROOT: z.string().default('storage'),
  WEB_DIST_DIR: z.string().optional(),
  FILE_MAX_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  FILE_MAX_PER_REQUEST: z.coerce.number().int().positive().default(FILE_MAX_PER_REQUEST),
  LLM_MODE: z.enum(['mock', 'live']).default('mock'),
  LLM_PRESET: z.enum(['openwebui', 'openai-compatible']).default('openwebui'),
  LLM_BASE_URL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),
  LLM_DEFAULT_MODEL: z.string().optional(),
  REQUEST_FIRST_TOKEN_MS: z.coerce.number().int().positive().default(60_000),
  REQUEST_FILES_FIRST_TOKEN_MS: z.coerce.number().int().positive().default(360_000),
  REQUEST_IDLE_MS: z.coerce.number().int().positive().default(60_000),
  REQUEST_LEASE_MS: z.coerce.number().int().positive().default(30_000),
  REQUEST_KEEPALIVE_MS: z.coerce.number().int().positive().default(10_000),
  REQUEST_SWEEP_MS: z.coerce.number().int().positive().default(30_000),
  REQUEST_FLUSH_MS: z.coerce.number().int().positive().default(250),
  REQUEST_BUDGET_BYTES: z.coerce.number().int().positive().default(262_144),
  REQUEST_MAX_ACTIVE: z.coerce.number().int().positive().default(20),
}).superRefine((e, ctx) => {
  if (e.AUTH_MODE === 'oidc') {
    if (!e.OIDC_ISSUER || !z.url().safeParse(e.OIDC_ISSUER).success) ctx.addIssue({ code: 'custom', path: ['OIDC_ISSUER'], message: '유효한 URL이 필요합니다' })
    if (!e.OIDC_CLIENT_ID) ctx.addIssue({ code: 'custom', path: ['OIDC_CLIENT_ID'], message: '필수 값입니다' })
    if (!e.OIDC_CLIENT_SECRET) ctx.addIssue({ code: 'custom', path: ['OIDC_CLIENT_SECRET'], message: '필수 값입니다' })
  }
  if (e.LLM_MODE === 'live') {
    if (!e.LLM_BASE_URL || !z.url().safeParse(e.LLM_BASE_URL).success || (e.LLM_PRESET === 'openwebui' && !isOriginUrl(e.LLM_BASE_URL))) {
      ctx.addIssue({ code: 'custom', path: ['LLM_BASE_URL'], message: e.LLM_PRESET === 'openwebui' ? 'origin URL이 필요합니다' : '유효한 URL이 필요합니다' })
    }
    if (!e.LLM_API_KEY) ctx.addIssue({ code: 'custom', path: ['LLM_API_KEY'], message: '필수 값입니다' })
  }
})

export type AppConfig = ReturnType<typeof loadConfig>

/** 환경 변수 → 설정. 비밀값은 여기서만 읽고 로그에 남기지 않는다. */
export function loadConfig(env: Record<string, string | undefined>) {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`설정 오류 — ${keys}`)
  }
  const e = parsed.data
  const appOrigin = e.APP_ORIGIN.replace(/\/+$/, '')
  const configFile = process.execArgv.find((arg) => arg.startsWith('--env-file='))?.slice('--env-file='.length)
  const configOutsideApp = configFile && (relative(process.cwd(), resolve(configFile)) === '..' || relative(process.cwd(), resolve(configFile)).startsWith(`..${sep}`))
  if (env.NODE_ENV === 'production' || configOutsideApp) {
    const relativeToApp = relative(process.cwd(), resolve(e.FILE_STORAGE_ROOT))
    if (!isAbsolute(e.FILE_STORAGE_ROOT) || relativeToApp === '' || relativeToApp !== '..' && !relativeToApp.startsWith(`..${sep}`)) {
      throw new Error('설정 오류 — FILE_STORAGE_ROOT: 운영에서는 app 밖의 절대 경로여야 합니다')
    }
  }
  return {
    port: e.API_PORT,
    appOrigin,
    databaseUrl: e.DATABASE_URL,
    sessionSecret: e.SESSION_SECRET,
    sessionTtlHours: e.SESSION_TTL_HOURS,
    sessionIdleHours: e.SESSION_IDLE_HOURS,
    authAttempts: { max: e.AUTH_ATTEMPT_MAX, windowMs: e.AUTH_ATTEMPT_WINDOW_MS, ipPendingMax: e.AUTH_IP_PENDING_MAX },
    trustProxy: e.TRUST_PROXY!,
    authMode: e.AUTH_MODE,
    cookieSecure: appOrigin.startsWith('https://'),
    oidc: e.AUTH_MODE === 'oidc' ? {
      issuer: e.OIDC_ISSUER!,
      clientId: e.OIDC_CLIENT_ID!,
      clientSecret: e.OIDC_CLIENT_SECRET!,
      redirectUri: `${appOrigin}/api/auth/callback`,
    } : undefined,
    initialSystemOwners: e.INITIAL_SYSTEM_OWNERS,
    fileStorageRoot: resolve(e.FILE_STORAGE_ROOT),
    webDistDir: resolve(e.WEB_DIST_DIR || resolve(import.meta.dirname, '../../../web/dist')),
    fileMaxBytes: e.FILE_MAX_BYTES,
    fileMaxPerRequest: e.FILE_MAX_PER_REQUEST,
    llm: { mode: e.LLM_MODE, preset: e.LLM_PRESET, baseUrl: e.LLM_BASE_URL, apiKey: e.LLM_API_KEY, defaultModel: e.LLM_DEFAULT_MODEL },
    request: { firstTokenMs: e.REQUEST_FIRST_TOKEN_MS, filesFirstTokenMs: e.REQUEST_FILES_FIRST_TOKEN_MS,
      idleMs: e.REQUEST_IDLE_MS, leaseMs: e.REQUEST_LEASE_MS, keepaliveMs: e.REQUEST_KEEPALIVE_MS,
      sweepMs: e.REQUEST_SWEEP_MS, flushMs: e.REQUEST_FLUSH_MS, budgetBytes: e.REQUEST_BUDGET_BYTES, maxActive: e.REQUEST_MAX_ACTIVE },
  }
}

export const CONFIG = Symbol('CONFIG')
