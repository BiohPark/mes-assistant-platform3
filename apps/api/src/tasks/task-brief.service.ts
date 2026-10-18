import { aiMessageContent } from '../llm/responseContent.js'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { eligibleMessages, type Message } from '@mes/domain'
import type { ChatBrief } from '@mes/contracts'
import { draftChatBrief, type ChatProvider } from '@mes/llm'
import { CONFIG, type AppConfig } from '../config/config.js'
import { DB, type Db } from '../db/db.module.js'
import { appSetting, appUser, assistant, message, task, taskBrief, thread } from '../db/schema.js'
import { EventsService } from '../events/events.service.js'
import { readEffectiveDefaultModel } from '../llm/effectiveDefaultModel.js'
import { LLM_PROVIDER } from '../llm/provider.token.js'
import { RequestsService } from '../requests/requests.service.js'
import { assertTaskAccess } from '../sr/access.js'

/** 같은 메시지 기준으로 실패한 뒤 다시 부르기까지 — 화면을 열 때마다 모델을 두드리지 않게 */
const RETRY_AFTER_MS = 5 * 60_000
/** 보조 슬롯 이름 — 사람의 제목·요약 슬롯과 겹치지 않는다 */
const ACTOR = 'system:brief'

/**
 * 대화 요약 카드(표시 전용). 1줄(무슨 대화)·3줄(다음 할 일 제안)은 대화 모델이 만들고, 2줄(질문 수·참여자·시작 시각)은 서버가 센다.
 * 진입(GET) 때 저장본 뒤로 새 메시지가 있고 AI 답이 하나 이상이면 백그라운드로 하나씩 만든다(전역 상한 admit + 보조 슬롯).
 * 실패는 화면을 막지 않는다 — 저장하지 않고, 같은 메시지 기준이면 RETRY_AFTER_MS 뒤에 다시 시도한다.
 * 결과는 task_brief에만 둔다 — 요청 조립·트레이·참조 요약은 이 표를 읽지 않는다.
 */
@Injectable()
export class TaskBriefService {
  private readonly queued = new Set<string>()
  private readonly failed = new Map<string, { seq: number; until: number }>()
  private chain: Promise<void> = Promise.resolve()

  constructor(@Inject(DB) private readonly db: Db, @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(LLM_PROVIDER) private readonly provider: ChatProvider, @Inject(RequestsService) private readonly requests: RequestsService,
    @Inject(EventsService) private readonly events: EventsService) {}

  async get(actor: string, taskId: string): Promise<ChatBrief> {
    await assertTaskAccess(this.db, actor, taskId)
    const { row, history } = await this.load(taskId)
    const eligible = eligibleMessages(history)
    const latestSeq = eligible.at(-1)?.seq ?? 0
    const [stored] = await this.db.select().from(taskBrief).where(eq(taskBrief.taskId, taskId))
    const stale = !!stored && stored.basedOnSeq < latestSeq
    const failed = this.failed.get(taskId)
    if (eligible.some((item) => item.role === 'assistant') && (!stored || stale) && !this.queued.has(taskId)
      && !(failed?.seq === latestSeq && failed.until > Date.now())) this.schedule(taskId, latestSeq)
    // 참여자: 이 대화에 글을 쓴 사람(팀 의견 포함), 처음 쓴 순서
    const authorIds = [...new Set(history.filter((item) => item.role === 'user' && item.status === 'done' && item.authorId).map((item) => item.authorId!))]
    const names = authorIds.length ? await this.db.select({ id: appUser.id, name: appUser.name }).from(appUser).where(inArray(appUser.id, authorIds)) : []
    const generating = this.queued.has(taskId)
    return {
      ...(stored && { ai: { about: stored.about, next: stored.nextAction, source: stored.source as 'ai' | 'rule', ...(stored.model && { model: stored.model }),
        basedOnSeq: stored.basedOnSeq, generatedAt: stored.generatedAt.toISOString() } }),
      stats: { questions: eligible.filter((item) => item.role === 'user').length, startedAt: row.createdAt.toISOString(),
        participants: authorIds.map((id) => ({ id, name: names.find((user) => user.id === id)?.name ?? id })) },
      generating, failed: !generating && failed?.seq === latestSeq, stale,
    }
  }

  /** 지금까지 넘긴 생성이 모두 끝날 때 — 테스트용 */
  settled() { return this.chain }

  private schedule(taskId: string, seq: number) {
    this.queued.add(taskId)
    this.chain = this.chain.then(async () => {
      try { await this.generate(taskId); this.failed.delete(taskId) }
      catch { this.failed.set(taskId, { seq, until: Date.now() + RETRY_AFTER_MS }) }
      finally { this.queued.delete(taskId) }
    })
  }

  private async load(taskId: string) {
    const [row] = await this.db.select().from(task).where(and(eq(task.id, taskId), isNull(task.deletedAt)))
    if (!row) throw new NotFoundException('대화를 찾을 수 없습니다')
    const [owner] = await this.db.select({ id: thread.id }).from(thread).where(eq(thread.taskId, taskId))
    const rows = owner ? await this.db.select().from(message).where(eq(message.threadId, owner.id)).orderBy(message.seq) : []
    const history: Message[] = rows.map((item) => ({ id: item.id, threadId: item.threadId, seq: item.seq, role: item.role as Message['role'],
      kind: item.kind as Message['kind'], content: aiMessageContent(item), status: item.status as Message['status'], createdAt: item.createdAt.toISOString(),
      attachmentIds: [], ...(item.authorId && { authorId: item.authorId }) }))
    return { row, history }
  }

  private async generate(taskId: string) {
    const { row, history } = await this.load(taskId)
    const eligible = eligibleMessages(history)
    const latestSeq = eligible.at(-1)?.seq ?? 0
    const [stored] = await this.db.select({ basedOnSeq: taskBrief.basedOnSeq }).from(taskBrief).where(eq(taskBrief.taskId, taskId))
    if (!eligible.some((item) => item.role === 'assistant') || (stored && stored.basedOnSeq >= latestSeq)) return
    const [agent] = await this.db.select({ modelId: assistant.modelId }).from(assistant).where(eq(assistant.id, row.assistantId))
    const model = row.modelId ?? agent?.modelId ?? await readEffectiveDefaultModel(this.db, this.config)
    const [budget] = await this.db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'requestBudgetBytes'))
    const limitBytes = typeof budget?.value === 'number' ? budget.value : this.config.request.budgetBytes
    // mock은 모델을 부르지 않으므로 전역 상한 슬롯을 쥐지 않는다
    const release = this.provider.kind === 'mock' ? () => undefined : await this.requests.admit('assistant')
    let result
    // 대화 원문이 길 수 있어 기본 30초 대신 첫 응답 대기 한도까지 기다린다
    try { result = await this.requests.runAuxiliary(ACTOR, 'brief', (signal) => draftChatBrief(this.provider, model, eligible, { limitBytes, signal }), { timeoutMs: this.config.request.firstTokenMs }) }
    finally { release() }
    const values = { about: result.about, nextAction: result.next, source: result.source, model: result.model ?? null, basedOnSeq: latestSeq, generatedAt: new Date() }
    await this.db.insert(taskBrief).values({ taskId, ...values }).onDuplicateKeyUpdate({ set: values })
    this.events.publish('brief.updated', { taskId })
  }
}
