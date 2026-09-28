import { resolve } from 'node:path'
import { z } from 'zod'
import { AuthModeSchema } from '@mes/contracts'

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
  AUTH_MODE: AuthModeSchema.default('local'),
  OIDC_ISSUER: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  INITIAL_SYSTEM_OWNERS: list,
  FILE_STORAGE_ROOT: z.string().default('storage'),
}).superRefine((e, ctx) => {
  if (e.AUTH_MODE !== 'oidc') return
  if (!e.OIDC_ISSUER || !z.url().safeParse(e.OIDC_ISSUER).success) ctx.addIssue({ code: 'custom', path: ['OIDC_ISSUER'], message: '유효한 URL이 필요합니다' })
  if (!e.OIDC_CLIENT_ID) ctx.addIssue({ code: 'custom', path: ['OIDC_CLIENT_ID'], message: '필수 값입니다' })
  if (!e.OIDC_CLIENT_SECRET) ctx.addIssue({ code: 'custom', path: ['OIDC_CLIENT_SECRET'], message: '필수 값입니다' })
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
  }
}

export const CONFIG = Symbol('CONFIG')
