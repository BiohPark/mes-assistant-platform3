import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { suggestFirstQuestions, type ChatProvider } from '@mes/llm'
import { CONFIG, type AppConfig } from '../config/config.js'
import { DB, type Db } from '../db/db.module.js'
import { assistant } from '../db/schema.js'
import { readEffectiveDefaultModel } from '../llm/effectiveDefaultModel.js'
import { LLM_PROVIDER } from '../llm/provider.token.js'
import { RequestsService } from '../requests/requests.service.js'
import { firstQuestionsKey, freshFirstQuestions, type FirstQuestionsSource } from './first-questions-key.js'

/** 같은 내용으로 실패한 뒤 다시 부르기까지 — 화면을 열 때마다 모델을 두드리지 않게 */
const RETRY_AFTER_MS = 5 * 60_000
/** 보조 슬롯 이름 — 사람의 제목·요약 슬롯과 겹치지 않는다 */
const ACTOR = 'system:first-questions'

/**
 * 에이전트별 추천 첫 질문을 백그라운드로 한 번 만들어 assistant 행에 저장한다.
 * 카탈로그 조회가 저장본이 없거나 낡은 에이전트를 넘기면 하나씩 차례로 만든다(전역 상한 admit + 보조 슬롯).
 * 실패는 화면에 드러내지 않는다 — 저장하지 않고, 같은 내용이면 RETRY_AFTER_MS 뒤에 다시 시도한다.
 */
@Injectable()
export class FirstQuestionsService {
  private readonly queued = new Set<string>()
  private readonly failed = new Map<string, { key: string; until: number }>()
  private chain: Promise<void> = Promise.resolve()

  constructor(@Inject(DB) private readonly db: Db, @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(LLM_PROVIDER) private readonly provider: ChatProvider, @Inject(RequestsService) private readonly requests: RequestsService) {}

  schedule(rows: Array<FirstQuestionsSource & { id: string }>) {
    if (this.provider.kind === 'mock') return
    for (const row of rows) {
      const failed = this.failed.get(row.id)
      if (this.queued.has(row.id) || (failed?.key === firstQuestionsKey(row) && failed.until > Date.now())) continue
      this.queued.add(row.id)
      this.chain = this.chain.then(async () => {
        try { await this.generate(row.id) }
        catch { this.failed.set(row.id, { key: firstQuestionsKey(row), until: Date.now() + RETRY_AFTER_MS }) }
        finally { this.queued.delete(row.id) }
      })
    }
  }

  /** 지금까지 넘긴 생성이 모두 끝날 때 — 테스트용 */
  settled() { return this.chain }

  private async generate(id: string) {
    const [row] = await this.db.select({ modelId: assistant.modelId, name: assistant.name, summary: assistant.summary, status: assistant.status,
      suggestedQuestions: assistant.suggestedQuestions, suggestedFor: assistant.suggestedFor }).from(assistant).where(eq(assistant.id, id))
    if (!row || row.status === 'retired' || freshFirstQuestions(row)) return
    const model = row.modelId ?? await readEffectiveDefaultModel(this.db, this.config)
    const release = await this.requests.admit('assistant')
    let questions: string[]
    // 시간 초과·중지는 runAuxiliary가 맡는다
    try { questions = await this.requests.runAuxiliary(ACTOR, 'suggest', (signal) => suggestFirstQuestions(this.provider, model, row, signal)) }
    finally { release() }
    // 생성 중에 내용이 바뀌었으면 옛 기준으로 저장된다 — 다음 조회에서 낡은 것으로 보고 다시 만든다
    await this.db.update(assistant).set({ suggestedQuestions: questions, suggestedFor: firstQuestionsKey(row) }).where(eq(assistant.id, id))
    this.failed.delete(id)
  }
}
