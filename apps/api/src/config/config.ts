import { resolve } from 'node:path'
import { z } from 'zod'

const list = z
  .string()
  .default('')
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))

const EnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET은 32자 이상'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  OIDC_ISSUER: z.url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  INITIAL_SYSTEM_OWNERS: list,
  FILE_STORAGE_ROOT: z.string().default('storage'),
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
  return {
    port: e.API_PORT,
    appOrigin,
    databaseUrl: e.DATABASE_URL,
    sessionSecret: e.SESSION_SECRET,
    sessionTtlHours: e.SESSION_TTL_HOURS,
    cookieSecure: appOrigin.startsWith('https://'),
    oidc: {
      issuer: e.OIDC_ISSUER,
      clientId: e.OIDC_CLIENT_ID,
      clientSecret: e.OIDC_CLIENT_SECRET,
      redirectUri: `${appOrigin}/api/auth/callback`,
    },
    initialSystemOwners: e.INITIAL_SYSTEM_OWNERS,
    fileStorageRoot: resolve(e.FILE_STORAGE_ROOT),
  }
}

export const CONFIG = Symbol('CONFIG')
