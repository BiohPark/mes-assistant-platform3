import { BadGatewayException, Controller, Get, Inject } from '@nestjs/common'
import { Roles } from '../auth/roles.decorator.js'
import { CONFIG, type AppConfig } from '../config/config.js'
import { RequestsService } from '../requests/requests.service.js'

export { LLM_PROVIDER } from './provider.token.js'

@Controller('llm')
export class LlmController {
  private cached?: { models: string[]; until: number }

  constructor(
    @Inject(RequestsService) private readonly requests: RequestsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('models')
  async models() {
    if (this.cached && this.cached.until > Date.now()) return { models: this.cached.models }
    try {
      const models = await this.requests.listModels()
      this.cached = { models, until: Date.now() + 60_000 }
      return { models }
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
