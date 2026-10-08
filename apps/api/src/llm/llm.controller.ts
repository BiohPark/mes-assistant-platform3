import { BadGatewayException, Controller, Get, Inject } from '@nestjs/common'
import { LlmModelIdSchema } from '@mes/contracts'
import { Roles } from '../auth/roles.decorator.js'
import { CONFIG, type AppConfig } from '../config/config.js'
import { RequestsService } from '../requests/requests.service.js'

export { LLM_PROVIDER } from './provider.token.js'

/** 상위 목록에서 쓸 수 있는 ID만 남긴다 — 공백 제거, 빈 값·제어 문자·191자 초과 제외, 순서 유지 중복 제거 */
export function normalizeModelIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (!id || id.length > 191 || !LlmModelIdSchema.safeParse(id).success || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

@Controller('llm')
export class LlmController {
  private cached?: { models: string[]; until: number }
  /** 캐시가 비어 있을 때 동시에 온 요청은 상위 호출 하나를 나눠 쓴다 */
  private inflight?: Promise<string[]>

  constructor(
    @Inject(RequestsService) private readonly requests: RequestsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('models')
  async models() {
    if (this.cached && this.cached.until > Date.now()) return { models: this.cached.models }
    try {
      this.inflight ??= this.requests.listModels().then((ids) => {
        const models = normalizeModelIds(ids)
        this.cached = { models, until: Date.now() + 60_000 }
        return models
      }).finally(() => { this.inflight = undefined })
      return { models: await this.inflight }
    } catch {
      throw new BadGatewayException('모델 목록 조회 실패: LLM 서비스 연결 또는 응답 오류')
    }
  }

  @Get('status')
  @Roles('system_owner')
  async status() {
    let result: { ok: boolean; detail: string }
    try { result = await this.requests.ping() } catch { result = { ok: false, detail: '연결 실패' } }
    const key = this.config.llm.apiKey
    const detail = result.detail.replace(/Authorization\s*[:=]\s*\S+(?:\s+\S+)?/gi, '[redacted]').replace(/Bearer\s+\S+/gi, '[redacted]')
    return {
      mode: this.config.llm.mode,
      preset: this.config.llm.preset,
      baseUrlHost: this.config.llm.baseUrl ? new URL(this.config.llm.baseUrl).host : '',
      ok: result.ok,
      detail: key ? detail.replaceAll(key, '[redacted]') : detail,
    }
  }
}
