import { BadRequestException, Body, Controller, HttpCode, HttpException, HttpStatus, Inject, Logger, Post, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import { eq } from 'drizzle-orm'
import { LIMITED_FETCH_MESSAGES, type ChatLimits, type ChatMessageInput, type ChatProvider } from '@mes/llm'
import { LlmTestRequestSchema, type LlmTestConnection, type LlmTestErrorCode, type LlmTestResult } from '@mes/contracts'
import type { AuthedRequest } from '../auth/guards.js'
import { Roles } from '../auth/roles.decorator.js'
import { CONFIG, type AppConfig } from '../config/config.js'
import { DB, type Db } from '../db/db.module.js'
import { appSetting } from '../db/schema.js'
import { RequestsService } from '../requests/requests.service.js'
import { LLM_PROVIDER } from './provider.token.js'
import { effectiveDefaultModel } from './effectiveDefaultModel.js'

/** 시험 호출 상한 — 총 60 s, 응답 64 KB, SSE 프레임 64 KB. 넘으면 절단 없이 실패 */
const TEST_LIMITS: Required<ChatLimits> = { timeoutMs: 60_000, maxResponseBytes: 64 * 1024, maxFrameBytes: 64 * 1024 }
const FRAME_TOO_LARGE = '응답 프레임 크기 초과'
const GENERIC = 'LLM 서비스 연결 또는 응답 오류'
const CODE_MESSAGE: Record<LlmTestErrorCode, string> = { TIMEOUT: '응답 시간 초과', RESPONSE_TOO_LARGE: '응답 크기 한도 초과', MODEL_NOT_FOUND: '모델을 찾을 수 없습니다', PROVIDER_ERROR: GENERIC }
/** 응답에 실어도 되는 문구만 — 상위 본문·주소·키가 섞인 메시지는 일반 문구로 바꾼다 */
const SAFE_MESSAGES = new Set([...Object.values(LIMITED_FETCH_MESSAGES), FRAME_TOO_LARGE, '응답 형식 오류', '모델 목록 네트워크 오류', '보조 요청 시간 초과', '보조 요청 중지'])
function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return SAFE_MESSAGES.has(message) || /^(HTTP \d{3}|LLM 서비스 오류 \(HTTP \d{3}\))$/.test(message) ? message : GENERIC
}
function classify(error: unknown): LlmTestErrorCode {
  const message = safeMessage(error)
  if (message === LIMITED_FETCH_MESSAGES.timeout || message === '보조 요청 시간 초과') return 'TIMEOUT'
  if (message === LIMITED_FETCH_MESSAGES.response_too_large || message === FRAME_TOO_LARGE) return 'RESPONSE_TOO_LARGE'
  if (/HTTP 404/.test(message)) return 'MODEL_NOT_FOUND'
  return 'PROVIDER_ERROR'
}
const elapsed = (started: number) => Math.round(performance.now() - started)

/** SO 전용 AI 연결 시험 — DB 쓰기 없음, 로그는 상태·소요 시간만 */
@Controller('admin/llm')
export class LlmAdminController {
  private readonly logger = new Logger(LlmAdminController.name)
  constructor(@Inject(RequestsService) private readonly requests: RequestsService, @Inject(LLM_PROVIDER) private readonly provider: ChatProvider,
    @Inject(CONFIG) private readonly config: AppConfig, @Inject(DB) private readonly db: Db) {}

  private get defaultModel() { return effectiveDefaultModel(this.config) }

  private async complete(model: string, messages: ChatMessageInput[], signal: AbortSignal): Promise<string> {
    let text = ''
    for await (const chunk of this.provider.stream({ model, messages, signal, limits: TEST_LIMITS })) {
      if (chunk.type === 'delta') text += chunk.text
      else if (chunk.type === 'error') throw new Error(chunk.message)
    }
    if (signal.aborted) throw new Error(LIMITED_FETCH_MESSAGES.aborted)
    return text
  }

  /** 전역 슬롯(admit) + 사용자별 단일 진행(runAuxiliary) 아래에서 모델을 한 번 부른다. 연결이 끊기면 중단한다 */
  private async guarded(req: AuthedRequest, res: Response, model: string, messages: ChatMessageInput[]): Promise<string> {
    const release = await this.requests.admit('test')
    const client = new AbortController()
    const onClose = () => { if (!res.writableEnded) client.abort() }
    res.on('close', onClose)
    try {
      return await this.requests.runAuxiliary(req.user!.id, 'test', (signal) => this.complete(model, messages, signal), { timeoutMs: TEST_LIMITS.timeoutMs, signal: client.signal })
    } finally {
      res.off('close', onClose)
      release()
    }
  }

  @Post('test-connection')
  @HttpCode(200)
  @Roles('system_owner')
  async testConnection(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<LlmTestConnection> {
    const model = this.defaultModel
    const listStarted = performance.now()
    const models = await this.provider.listModels().then(
      (ids) => ({ ok: true, count: ids.length, ms: elapsed(listStarted) }),
      (error: unknown) => ({ ok: false, count: 0, ms: elapsed(listStarted), error: safeMessage(error) }))
    const completionStarted = performance.now()
    const completion = await this.guarded(req, res, model, [{ role: 'user', content: 'ping' }]).then(
      () => ({ ok: true, ms: elapsed(completionStarted), model }),
      (error: unknown) => { if (error instanceof HttpException) throw error; return { ok: false, ms: elapsed(completionStarted), model, error: safeMessage(error) } })
    this.logger.log(`test-connection models=${models.ok ? 'ok' : 'fail'} ${models.ms}ms completion=${completion.ok ? 'ok' : 'fail'} ${completion.ms}ms`)
    return { models, completion }
  }

  @Post('test')
  @HttpCode(200)
  @Roles('system_owner')
  async test(@Body() body: unknown, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<LlmTestResult> {
    const parsed = LlmTestRequestSchema.safeParse(body)
    if (!parsed.success || parsed.data.messages.at(-1)?.role !== 'user') throw new BadRequestException('요청 형식이 올바르지 않습니다')
    const model = parsed.data.model ?? this.defaultModel
    const messages: ChatMessageInput[] = parsed.data.messages
    const [budgetSetting] = await this.db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'requestBudgetBytes'))
    const limit = typeof budgetSetting?.value === 'number' ? budgetSetting.value : this.config.request.budgetBytes
    if (Buffer.byteLength(JSON.stringify({ model, messages, stream: true })) > limit) throw new HttpException('요청 크기 한도 초과', HttpStatus.PAYLOAD_TOO_LARGE)
    const started = performance.now()
    try {
      const text = await this.guarded(req, res, model, messages)
      const ms = elapsed(started)
      this.logger.log(`test 200 ${ms}ms`)
      return { text, model, ms }
    } catch (error) {
      if (error instanceof HttpException) throw error
      const code = classify(error)
      const status = code === 'TIMEOUT' ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.BAD_GATEWAY
      this.logger.log(`test ${status} ${elapsed(started)}ms ${code}`)
      throw new HttpException({ message: CODE_MESSAGE[code], code }, status)
    }
  }
}
