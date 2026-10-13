import { BadRequestException, HttpException, Inject, Injectable, Logger } from '@nestjs/common'
import { access, statfs } from 'node:fs/promises'
import { constants } from 'node:fs'
import { arch, platform, release } from 'node:os'
import type { Pool } from 'mysql2/promise'
import { OwuiProbeResultSchema, type OwuiProbeReport } from '@mes/contracts'
import { OwuiProbeUnknownModelError, probeOpenWebUi } from '@mes/llm'
import { CONFIG, type AppConfig } from '../config/config.js'
import { DB, DB_CLIENT, type Db } from '../db/db.module.js'
import { buildInfo } from '../health/build-info.js'
import { effectiveDefaultModel, readEffectiveDefaultModel } from '../llm/effectiveDefaultModel.js'
import { toLlmSettings } from '../llm/presets.js'
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

/** 진단 전체 상한(3분) 위의 여유 — 시험 자체는 probeOpenWebUi의 마감이 끊는다 */
const PROBE_GUARD_MS = 185_000

@Injectable()
export class DiagnosticsService {
  private readonly logger = new Logger(DiagnosticsService.name)
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DB_CLIENT) private readonly dbClient: Pool,
    @Inject(RequestsService) private readonly requests: RequestsService,
    @Inject(DB) private readonly settingsDb: Db,
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

    let defaultModel: string
    try { defaultModel = await readEffectiveDefaultModel(this.settingsDb, this.config) }
    catch {
      defaultModel = effectiveDefaultModel(this.config)
      db.error ??= 'DB 설정 조회 실패'
    }

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
        defaultModel, ok, detail, ms: Math.round(performance.now() - started) },
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

  /**
   * OpenWebUI 진단(S10-5) — 전역 응답 상한(admit)과 사용자별 보조 요청 단일 진행 아래에서 돈다.
   * 결과는 저장하지 않고, 로그는 상태 코드·소요 시간만 남긴다. 키·호스트는 한 번 더 가린다.
   */
  async probeOpenWebUi(actor: string, model: string, signal?: AbortSignal): Promise<OwuiProbeReport> {
    if (this.config.llm.mode !== 'live') throw new BadRequestException('Live 모드에서만 진단할 수 있습니다')
    const release = await this.requests.admit('test')
    try {
      const settings = toLlmSettings(this.config.llm)
      const result = await this.requests.runAuxiliary(actor, 'test', (auxSignal) => probeOpenWebUi(settings, model, { signal: auxSignal }), { timeoutMs: PROBE_GUARD_MS, signal })
      this.logger.log(`openwebui-probe ${result.attempts.map((a) => a.status ?? 'none').join('/')} ${result.ms}ms`)
      const host = URL.canParse(settings.baseUrl) ? new URL(settings.baseUrl).host : ''
      return OwuiProbeResultSchema.parse(redact(result, [this.config.llm.apiKey, host].filter(Boolean)))
    } catch (error) {
      if (error instanceof HttpException) throw error
      if (error instanceof OwuiProbeUnknownModelError) throw new BadRequestException('모델 목록에 없는 모델입니다')
      throw new HttpException('OpenWebUI 진단을 마치지 못했습니다', 504)
    } finally { release() }
  }
}
