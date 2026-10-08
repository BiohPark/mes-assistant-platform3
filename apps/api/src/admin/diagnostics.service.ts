import { Inject, Injectable } from '@nestjs/common'
import { access, statfs } from 'node:fs/promises'
import { constants } from 'node:fs'
import { arch, platform, release } from 'node:os'
import type { Pool } from 'mysql2/promise'
import { CONFIG, type AppConfig } from '../config/config.js'
import { DB_CLIENT } from '../db/db.module.js'
import { buildInfo } from '../health/build-info.js'
import { effectiveDefaultModel } from '../llm/effectiveDefaultModel.js'
import { RequestsService } from '../requests/requests.service.js'

type ServerError = { at: string; path: string; status: number; message: string }
const recentErrors: ServerError[] = []

function redact<T>(value: T, secrets: string[]): T {
  if (typeof value === 'string') return secrets.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), value) as T
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secrets)])) as T
  return value
}

export function recordServerError(path: string, status: number) {
  if (status < 500) return
  recentErrors.push({ at: new Date().toISOString(), path: path.slice(0, 200), status, message: `HTTP ${status}` })
  if (recentErrors.length > 50) recentErrors.shift()
}

@Injectable()
export class DiagnosticsService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DB_CLIENT) private readonly dbClient: Pool,
    @Inject(RequestsService) private readonly requests: RequestsService,
  ) {}

  async get() {
    const info = buildInfo()
    let db: { version: string; charset: string; collation: string; migrations: number | null; error?: string }
    try {
      const [rows] = await this.dbClient.query('select version() as version, @@character_set_server as charset, @@collation_server as collation')
      const row = (rows as { version: string; charset: string; collation: string }[])[0]!
      let migrations: number | null = null
      try {
        const [countRows] = await this.dbClient.query('select count(*) as count from __drizzle_migrations')
        migrations = Number((countRows as { count: number }[])[0]?.count ?? 0)
      } catch { /* migration table may not exist before first migration */ }
      db = { ...row, migrations }
    } catch { db = { version: '', charset: '', collation: '', migrations: null, error: 'DB 조회 실패' } }

    const started = performance.now()
    let ok = false
    let detail = '연결 실패'
    try {
      const ping = await this.requests.ping()
      ok = ping.ok
      detail = ping.ok ? '연결 성공' : /^HTTP \d{3}$|^응답 형식 오류$|^연결 실패$/.test(ping.detail) ? ping.detail : '연결 실패'
    } catch { /* redact provider errors */ }
    let writable = false
    let freeBytes: number | null = null
    try {
      await access(this.config.fileStorageRoot, constants.W_OK)
      writable = true
      const stats = await statfs(this.config.fileStorageRoot)
      freeBytes = stats.bavail * stats.bsize
    } catch { /* path or filesystem unavailable */ }

    let databasePassword = false
    let dbPassword = ''
    try { dbPassword = decodeURIComponent(new URL(this.config.databaseUrl).password); databasePassword = Boolean(dbPassword) } catch { /* malformed URL */ }
    const result = {
      app: { version: info.version, commit: info.commit, builtAt: info.builtAt, node: process.version, os: `${platform()} ${release()} ${arch()}` },
      db,
      llm: { mode: this.config.llm.mode, preset: this.config.llm.preset,
        baseUrlHost: URL.canParse(this.config.llm.baseUrl) ? new URL(this.config.llm.baseUrl).hostname : '',
        defaultModel: effectiveDefaultModel(this.config), ok, detail, ms: Math.round(performance.now() - started) },
      storage: { path: this.config.fileStorageRoot, writable, freeBytes },
      trustProxy: this.config.trustProxy,
      settings: { authMode: this.config.authMode, apiPort: this.config.port, fileMaxBytes: this.config.fileMaxBytes,
        fileMaxPerRequest: this.config.fileMaxPerRequest, requestMaxActive: this.config.request.maxActive },
      secrets: { databasePassword, sessionSecret: Boolean(this.config.sessionSecret), llmApiKey: Boolean(this.config.llm.apiKey),
        oidcClientSecret: Boolean(this.config.oidc?.clientSecret), devUserPassword: Boolean(process.env.DEV_USER_PASSWORD) },
      recentErrors: recentErrors.slice(),
    }
    return redact(result, [dbPassword, this.config.sessionSecret, this.config.llm.apiKey,
      this.config.oidc?.clientSecret ?? '', process.env.DEV_USER_PASSWORD ?? ''].filter(Boolean))
  }
}
