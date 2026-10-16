import { linkedTaskSrs } from '../tasks/sr-inputs.service.js'
import { DbConversationInputsService } from '../context/conversation-inputs.service.js'
import { randomUUID } from 'node:crypto'
import { resumeHeldTask } from '../tasks/resume-held-task.js'
import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException, type OnModuleDestroy } from '@nestjs/common'
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { buildChatRequest, composeSrDraft, createProvider, OWUI_DEFAULT_KEYS, refineSrDraft, suggestTitle, summarizeConversation, SrDraftBudgetError, SummaryBudgetError, type ChatProvider, type ChatScope, type SrAiOptions, type SrDraftText, type SrProposal } from '@mes/llm'
import type { LlmSettings, Message, RequestInfo, RequestInput, ServiceRequest, Thread } from '@mes/domain'
import { CONFIG, type AppConfig } from '../config/config.js'
import { DB, type Db } from '../db/db.module.js'
import { isDuplicateKey } from '../db/errors.js'
import { activityLog, appSetting, assistant, chatRequest, chatRequestInput, conversationInput, dbLock, fileObject, message, messageAttachment, serviceRequest, srInput, task, taskInput, thread } from '../db/schema.js'
import { FileStorageService } from '../files/fileStorage.service.js'
import { EventsService } from '../events/events.service.js'
import { DbLlmPorts } from '../llm/dbLlmPorts.js'
import { readEffectiveDefaultModel } from '../llm/effectiveDefaultModel.js'
import { LLM_PROVIDER } from '../llm/provider.token.js'
import { assertThreadAccess } from '../sr/access.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type EventName = 'started' | 'phase' | 'delta' | 'reasoning' | 'replace' | 'completed' | 'failed'
export type RequestEvent = { event: EventName; data: Record<string, unknown> }
type Listener = (event: RequestEvent) => void
export interface StartBody { content: string; attachmentIds?: string[]; oneShotFileIds?: string[] }
export interface RetryBody { excludeFileIds?: string[]; forceInlineFileIds?: string[] }
export interface EstimateBody { draft?: string; attachmentIds?: string[]; oneShotFileIds?: string[] }
export interface StartedRequest { id: string; replyMessageId: string; userMessageId: string; done: Promise<void> }
/** SR 자동작성·다듬기 스트리밍 훅 — onStart는 슬롯 확보 뒤, onDelta는 받은 조각마다 */
export interface SrAiStreamOptions { signal?: AbortSignal; onStart?: () => void; onDelta?: (text: string) => void }
interface SrAiCallOptions extends SrAiStreamOptions { kind: 'compose' | 'refine' }
/** 전체 상한은 첫 토큰·무응답 기준(config.request)이 대신한다 — 달성도 점검과 같다 */
const SR_AUXILIARY_TIMEOUT_MS = 2_147_483_647

const ACTIVE = ['pending', 'streaming']
const dbLeaseUntil = (ms: number) => sql`timestampadd(microsecond, ${ms * 1000}, current_timestamp(6))`
const STOPPED = '요청을 중지했습니다.'
const TIMEOUT = '응답 시간 초과 — 제한 시간 안에 응답이 오지 않았습니다.'
const maxLabel = (ms: number) => ms >= 60_000 ? `${Math.round(ms / 60_000)}분` : `${Math.ceil(ms / 1000)}초`
const STALE = '응답이 중단되었습니다 — 요청한 화면이 닫혔거나 연결이 끊겼습니다. 자동으로 다시 보내지 않았습니다.'
const errorCode = (status: string, error: string | null, bytes: number) => {
  if (status === 'cancelled') return 'CANCELLED'
  if (status === 'interrupted') return 'INTERRUPTED'
  if (status !== 'failed') return null
  if (error?.includes('요청 크기 한도 초과')) return 'REQUEST_TOO_LARGE'
  if (error?.includes('OpenWebUI에 전달하지 못해')) return 'DELIVERY_FAILED'
  if (error?.includes('시간 초과')) return 'TIMEOUT'
  return bytes === 0 ? 'BUILD_FAILED' : 'PROVIDER_ERROR'
}
class FencedTransition extends Error {}
/** 요청 시작 때 확정(소비)한 파일 자료 — 스테이징(보낼 자료)과 이번 메시지 첨부. 조립·재시도의 기준이다 */
type StagedFile = { fileId: string; weight: 'main' | 'reference'; oneShot: boolean }
const mainFirst = <T extends { weight: string }>(items: T[]) => [...items.filter((item) => item.weight === 'main'), ...items.filter((item) => item.weight !== 'main')]
const publicInfo = (info: RequestInfo | undefined) => info ? { ...info, inputs: info.inputs.map((item) => {
  if (item.kind !== 'file') return item
  const { remoteId: _remoteId, ...visible } = item
  return visible
}) } : undefined

@Injectable()
export class RequestsService implements OnModuleDestroy {
  static createProvider(settings: LlmSettings, readOwuiTools?: () => Promise<'auto' | 'off'>): ChatProvider { return createProvider(settings, readOwuiTools) }
  private readonly storage: FileStorageService
  private readonly runs = new Map<string, AbortController>()
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly events = new Map<string, RequestEvent[]>()
  private readonly truncated = new Set<string>()
  private readonly streamText = new Map<string, string>()
  private readonly streamReasoning = new Map<string, string>()
  /** 요청별 첫 응답·무응답·최대 처리 제한(ms) — 화면의 '제한까지 남은 시간'용. 없으면(다른 인스턴스·재시작) 기록된 파일 자료로 다시 계산한다 */
  private readonly limits = new Map<string, { firstTokenMs: number; idleMs: number; maxMs: number }>()
  private readonly auxiliaryUsers = new Set<string>()
  /** DB 행이 없는 모델 호출(시험 대화·연결 시험)이 쥔 전역 슬롯 — 단일 인스턴스 전제(D43) */
  private extraActive = 0
  private sweepTimer?: ReturnType<typeof setInterval>

  constructor(@Inject(DB) private readonly db: Db, @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(LLM_PROVIDER) private readonly provider: ChatProvider, @Inject(EventsService) private readonly appEvents?: EventsService) {
    this.storage = new FileStorageService(config.fileStorageRoot)
  }

  async startSweeper() {
    await this.recoverOnStartup().catch(() => undefined)
    this.sweepTimer = setInterval(() => { void this.sweep().catch(() => undefined) }, this.config.request.sweepMs)
    this.sweepTimer.unref?.()
  }
  onModuleDestroy() { if (this.sweepTimer) clearInterval(this.sweepTimer) }
  listModels() { return this.provider.listModels() }
  ping() { return this.provider.ping() }
  /**
   * 전역 동시 상한(maxActive) 입장 — 채팅 시작과 같은 전역 용량 잠금 아래에서 DB 진행 중 chat_request + 메모리 슬롯을 세고,
   * 상한이면 429. 잠금을 쥔 채 슬롯을 늘려 채팅 시작 트랜잭션과 어느 순서로 겹쳐도 상한을 넘지 않는다.
   * 돌려주는 함수로 슬롯을 반환한다(여러 번 불러도 한 번만).
   */
  async admit(_kind: 'test' | 'assistant'): Promise<() => void> {
    await this.db.transaction(async (tx) => {
      await this.lockGlobalCapacity(tx)
      await this.assertGlobalCapacity(tx)
      this.extraActive++
    })
    let released = false
    return () => { if (!released) { released = true; this.extraActive-- } }
  }
  async suggestSrTitle(actor: string, threadId: string): Promise<string | undefined> {
    const { owner, history } = await this.intakeHistory(actor, threadId)
    if (!history.some((row) => row.role === 'user')) return undefined
    return this.runAuxiliary(actor, 'title', async (signal) => suggestTitle(this.provider, await this.srModel(owner.modelId), history, signal))
  }
  /** 접수 대화의 완료된 메시지(SR 보조 호출 공통). 접근 검증 포함. */
  private async intakeHistory(actor: string, threadId: string) {
    await assertThreadAccess(this.db, actor, threadId)
    const [owner] = await this.db.select().from(thread).where(eq(thread.id, threadId))
    if (!owner?.srId) throw new BadRequestException('접수 대화가 아닙니다')
    const rows = await this.db.select().from(message).where(eq(message.threadId, threadId)).orderBy(message.seq)
    const history: Message[] = rows.filter((row) => row.status === 'done').map((row) => ({ id: row.id, threadId,
      seq: row.seq, role: row.role as Message['role'], kind: row.kind as Message['kind'], content: row.content,
      authorId: row.authorId ?? undefined, status: row.status as Message['status'], createdAt: row.createdAt.toISOString(), attachmentIds: [] }))
    return { owner, history }
  }
  /**
   * SR 자동작성·다듬기 제안(보조 호출, 저장 없음) 공통부 — 접수 에이전트 모델, 본 요청의 첫 토큰·무응답 기준, 요청 크기 한도(초과는 413, 자르지 않음).
   * onStart는 슬롯을 잡은 뒤(429 이후) 불려 SSE 헤더를 늦게 보낼 수 있게 한다.
   */
  private async srProposal(actor: string, threadId: string, options: SrAiCallOptions,
    run: (model: string, history: Message[], opts: SrAiOptions) => Promise<SrProposal>): Promise<SrProposal> {
    const { owner, history } = await this.intakeHistory(actor, threadId)
    const [budgetSetting] = await this.db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'requestBudgetBytes'))
    const limitBytes = typeof budgetSetting?.value === 'number' ? budgetSetting.value : this.config.request.budgetBytes
    try {
      return await this.runAuxiliary(actor, options.kind, async (signal) => {
        const model = await this.srModel(owner.modelId)
        if (signal.aborted) throw new Error('보조 요청 중지')
        options.onStart?.()
        return run(model, history, { limitBytes, signal, onDelta: options.onDelta, timeouts: this.config.request })
      }, { signal: options.signal, timeoutMs: SR_AUXILIARY_TIMEOUT_MS })
    } catch (error) { if (error instanceof SrDraftBudgetError) throw new HttpException(error.message, 413); throw error }
  }
  /** AI 자동작성 제안 — 접수 대화 전체로 제목·본문 초안. 적용은 사람이 한다. */
  composeSrDraft(actor: string, threadId: string, options: SrAiStreamOptions = {}): Promise<SrProposal> {
    return this.srProposal(actor, threadId, { ...options, kind: 'compose' }, (model, history, opts) => composeSrDraft(this.provider, model, history, opts))
  }
  /** AI 다듬기 제안 — 현재 제목·본문을 뜻 그대로 다듬고, 대화에서 빠진 점은 추천 목록으로만. 적용은 사람이 한다. */
  refineSrDraft(actor: string, threadId: string, draft: SrDraftText, options: SrAiStreamOptions = {}): Promise<SrProposal> {
    return this.srProposal(actor, threadId, { ...options, kind: 'refine' }, (model, history, opts) => refineSrDraft(this.provider, model, draft, history, opts))
  }
  private async srModel(threadModelId: string | null) {
    const [setting] = await this.db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'srIntakeAssistantId'))
    const [intake] = typeof setting?.value === 'string' ? await this.db.select().from(assistant).where(eq(assistant.id, setting.value)) : []
    return threadModelId ?? intake?.modelId ?? await readEffectiveDefaultModel(this.db, this.config)
  }
  async draftConversationSummary(actor: string, taskId: string, messages: Message[], signal?: AbortSignal) {
    const ports = new DbLlmPorts(this.db, this.config, actor)
    const [owner, agents, users, settings] = await Promise.all([ports.getTask(taskId), ports.getAssistants(), ports.getUsers(), ports.getSettings()])
    if (!owner) throw new NotFoundException('대화를 찾을 수 없습니다')
    const limitBytes = settings.requestBudgetBytes ?? this.config.request.budgetBytes
    if (Buffer.byteLength(messages.map((item) => item.content).join('\n\n')) > limitBytes) throw new HttpException('요약할 원문이 요청 크기 한도를 넘습니다', 413)
    const model = owner.modelId ?? agents.find((item) => item.id === owner.assistantId)?.modelId ?? settings.llm.model
    const userMap = new Map(users.map((user) => [user.id, user]))
    try { return await this.runAuxiliary(actor, 'summary', (auxSignal) => summarizeConversation(this.provider, model, messages, userMap, { limitBytes, signal: auxSignal }), { signal }) }
    catch (error) { if (error instanceof SummaryBudgetError) throw new HttpException(error.message, 413); throw error }
  }
  /** 사용자별 단일 진행 — 도우미(assistant)는 제목·요약 등 다른 보조 호출과 별도 슬롯(U4). 전역 상한은 admit이 따로 센다 */
  async runAuxiliary<T>(actor: string, kind: 'title' | 'summary' | 'checklist' | 'refine' | 'compose' | 'test' | 'assistant' | 'suggest' | 'brief', operation: (signal: AbortSignal) => Promise<T>,
    options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    const slot = kind === 'assistant' ? `${actor}:assistant` : `${actor}:aux`
    if (this.auxiliaryUsers.has(slot)) throw new HttpException(kind === 'assistant' ? '다른 보조 요청이 진행 중입니다' : '보조 요청이 이미 진행 중입니다', 429)
    this.auxiliaryUsers.add(slot)
    const controller = new AbortController()
    const abort = () => controller.abort('cancelled')
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    const timer = setTimeout(() => controller.abort('timeout'), options.timeoutMs ?? 30_000)
    try {
      if (controller.signal.aborted) throw new Error('보조 요청 중지')
      const stopped = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error(controller.signal.reason === 'timeout' ? '보조 요청 시간 초과' : '보조 요청 중지')), { once: true }))
      const work = operation(controller.signal)
      try { return await Promise.race([work, stopped]) }
      catch (error) { await work.catch(() => undefined); throw error }
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      this.auxiliaryUsers.delete(slot)
    }
  }
  private safeError(error: unknown) {
    if (!(error instanceof Error)) return '요청 처리 오류'
    const key = this.config.llm.apiKey
    return error.message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replaceAll(key || '\u0000', '[redacted]')
  }

  subscribe(id: string, listener: Listener): () => void {
    const set = this.listeners.get(id) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(id, set)
    for (const event of this.events.get(id) ?? []) listener(event)
    return () => { set.delete(listener); if (!set.size) this.listeners.delete(id) }
  }
  private emit(id: string, event: RequestEvent) {
    const history = this.events.get(id) ?? []
    history.push(event)
    if (event.event === 'delta' || event.event === 'reasoning' || event.event === 'replace' || event.event === 'phase') {
      let bytes = history.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)), 0)
      while (history.length > 2001 || bytes > 256 * 1024) {
        const first = history.findIndex((item) => item.event !== 'started')
        if (first < 0) break
        bytes -= Buffer.byteLength(JSON.stringify(history[first]))
        if (history[first]!.event === 'delta' || history[first]!.event === 'reasoning') this.truncated.add(id)
        history.splice(first, 1)
      }
    }
    this.events.set(id, history)
    for (const listener of this.listeners.get(id) ?? []) listener(event)
    if (event.event === 'completed' || event.event === 'failed') {
      const timer = setTimeout(() => { this.events.delete(id); this.truncated.delete(id); this.streamText.delete(id); this.streamReasoning.delete(id); this.limits.delete(id) }, 60_000)
      timer.unref?.()
    }
  }

  private async lockedOwner(tx: Tx, threadId: string) {
    const [candidate] = await tx.select().from(thread).where(eq(thread.id, threadId))
    if (!candidate) throw new NotFoundException('스레드를 찾을 수 없습니다')
    if (candidate.taskId) {
      const [owner] = await tx.select().from(task).where(and(eq(task.id, candidate.taskId), isNull(task.deletedAt))).for('update')
      if (!owner) throw new NotFoundException('대화를 찾을 수 없습니다')
      if (owner.status === 'done') throw new ConflictException({ code: 'TASK_DONE' })
    }
    const [locked] = await tx.select().from(thread).where(eq(thread.id, threadId)).for('update')
    if (!locked) throw new NotFoundException('스레드를 찾을 수 없습니다')
    return locked
  }

  private async lockGlobalCapacity(tx: Tx) {
    const lockKey = 'chat-request:global-capacity'
    await tx.insert(dbLock).values({ lockKey }).onDuplicateKeyUpdate({ set: { lockKey } })
    await tx.select({ key: dbLock.lockKey }).from(dbLock).where(eq(dbLock.lockKey, lockKey)).for('update')
  }

  private async assertGlobalCapacity(tx: Tx) {
    const [row] = await tx.select({ count: sql<number>`count(*)` }).from(chatRequest).where(inArray(chatRequest.status, ACTIVE))
    if (Number(row?.count ?? 0) + this.extraActive >= this.config.request.maxActive) throw new HttpException('동시 응답이 많아 잠시 후 다시 시도해 주세요.', 429)
  }

  private async scope(owner: typeof thread.$inferSelect, ports: DbLlmPorts): Promise<ChatScope> {
    if (owner.taskId) {
      const ownerTask = await ports.getTask(owner.taskId)
      const selected = (await ports.getAssistants()).find((item) => item.id === ownerTask?.assistantId)
      if (!ownerTask || !selected) throw new NotFoundException('대화 또는 에이전트를 찾을 수 없습니다')
      return { kind: 'task', task: ownerTask, assistant: selected }
    }
    const [sr] = await this.db.select().from(serviceRequest).where(eq(serviceRequest.id, owner.srId!))
    const settings = await ports.getSettings()
    const intake = (await ports.getAssistants()).find((item) => item.id === settings.srIntakeAssistantId)
    if (!sr || !intake) throw new NotFoundException('SR 또는 접수 에이전트를 찾을 수 없습니다')
    const scopeSr: ServiceRequest = { id: sr.id, code: sr.code ?? '', requesterId: sr.requesterId, title: sr.title,
      titleSource: sr.titleSource as ServiceRequest['titleSource'], body: sr.body, status: sr.status as ServiceRequest['status'],
      attachmentIds: [], threadId: owner.id, results: [], createdAt: sr.createdAt.toISOString(), updatedAt: sr.updatedAt.toISOString() }
    return { kind: 'sr', sr: scopeSr, intake, files: await ports.getFilesBySr(sr.id) }
  }

  async estimate(actor: string, threadId: string, body: EstimateBody): Promise<RequestInfo & { overLimit: boolean; attachmentLimit: number }> {
    await assertThreadAccess(this.db, actor, threadId)
    const [owner] = await this.db.select().from(thread).where(eq(thread.id, threadId))
    if (!owner) throw new NotFoundException('스레드를 찾을 수 없습니다')
    if (owner.taskId) {
      const [active] = await this.db.select({ id: task.id }).from(task).where(and(eq(task.id, owner.taskId), isNull(task.deletedAt)))
      if (!active) throw new NotFoundException('대화를 찾을 수 없습니다')
    }
    const attachments = [...new Set(body.attachmentIds ?? [])]
    const oneShot = [...new Set(body.oneShotFileIds ?? [])]
    const [attachmentSetting] = await this.db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'fileMaxPerRequest'))
    const attachmentLimit = typeof attachmentSetting?.value === 'number' ? attachmentSetting.value : this.config.fileMaxPerRequest
    if (attachments.length > attachmentLimit) throw new HttpException({ code: 'ATTACHMENT_LIMIT' }, 413)
    if (oneShot.some((id) => !attachments.includes(id))) throw new BadRequestException('첨부 파일 ID가 올바르지 않습니다')
    if (attachments.length) {
      const valid = await this.db.select({ id: fileObject.id }).from(fileObject).where(and(inArray(fileObject.id, attachments),
        owner.srId ? eq(fileObject.originSrId, owner.srId) : eq(fileObject.originTaskId, owner.taskId!), isNull(fileObject.deletedAt)))
      if (valid.length !== attachments.length) throw new BadRequestException('첨부 파일이 이 대화에 없습니다')
    }
    // 대화에 올린 첨부는 모두 이번 요청에만 간다(D54 개정). 보낼 자료(스테이징)는 대화의 현재 선택 그대로
    const ports = new DbLlmPorts(this.db, this.config, actor, this.storage)
    const scope = await this.scope(owner, ports)
    const rows = await this.db.select().from(message).where(eq(message.threadId, threadId)).orderBy(message.seq)
    const history: Message[] = rows.map((item) => ({ id: item.id, threadId, seq: item.seq, role: item.role as Message['role'],
      content: item.content, authorId: item.authorId ?? undefined, createdAt: item.createdAt.toISOString(), attachmentIds: [],
      status: item.status as Message['status'], kind: item.kind as Message['kind'] }))
    history.push({ id: 'draft', threadId, role: 'user', content: body.draft?.trim() ?? '', authorId: actor,
      createdAt: new Date().toISOString(), attachmentIds: attachments, status: 'done' })
    const domainThread: Thread = { id: owner.id, ...(owner.taskId ? { taskId: owner.taskId } : { srId: owner.srId! }), title: owner.title,
      createdBy: owner.createdBy, createdAt: owner.createdAt.toISOString(), archived: false, ...(owner.modelId ? { modelId: owner.modelId } : {}) }
    const { info } = await buildChatRequest(scope, domainThread, history, { dryRun: true, oneShotFileIds: attachments }, ports)
    return { ...publicInfo(info)!, overLimit: info.bytes > info.limitBytes, attachmentLimit }
  }

  private async replay(row: typeof chatRequest.$inferSelect): Promise<StartedRequest> {
    const record = await this.get(row.id)
    const started = { event: 'started', data: { requestId: row.id, replyMessageId: row.replyMessageId, userMessageId: row.userMessageId, createdAt: row.createdAt.toISOString(),
      firstTokenMs: record.firstTokenMs, idleMs: record.idleMs, maxMs: record.maxMs } } as const
    if (this.truncated.has(row.id) || !this.events.has(row.id)) {
      const [reply] = await this.db.select({ content: message.content, reasoning: message.reasoning }).from(message).where(eq(message.id, row.replyMessageId))
      this.events.set(row.id, [{ event: 'started', data: { ...started.data, resumedText: this.streamText.get(row.id) ?? reply?.content ?? '', resumedReasoning: this.streamReasoning.get(row.id) ?? reply?.reasoning ?? '' } }])
      if (record.phase) this.emit(row.id, { event: 'phase', data: { text: record.phase } })
      if (record.status === 'succeeded') this.emit(row.id, { event: 'completed', data: { requestInfo: record } })
      if (['failed', 'cancelled', 'interrupted'].includes(record.status)) this.emit(row.id, { event: 'failed', data: { error: record.error ?? '요청 실패', code: record.code, requestInfo: record } })
    }
    return { id: row.id, replyMessageId: row.replyMessageId, userMessageId: row.userMessageId, done: Promise.resolve() }
  }

  private async hasActiveOrKey(threadId: string, key: string): Promise<boolean> {
    const [sameKey] = await this.db.select({ id: chatRequest.id }).from(chatRequest)
      .where(and(eq(chatRequest.threadId, threadId), eq(chatRequest.idempotencyKey, key))).limit(1)
    if (sameKey) return true
    const [active] = await this.db.select({ id: chatRequest.id }).from(chatRequest)
      .where(and(eq(chatRequest.threadId, threadId), inArray(chatRequest.status, ACTIVE))).limit(1)
    return !!active
  }

  async start(actor: string, threadId: string, body: StartBody, key: string): Promise<StartedRequest> {
    await assertThreadAccess(this.db, actor, threadId)
    if (!key?.trim()) throw new BadRequestException('Idempotency-Key가 필요합니다')
    if ([...key].length > 191) throw new BadRequestException('Idempotency-Key가 너무 깁니다')
    const attachments = [...new Set(body.attachmentIds ?? [])]
    const oneShot = [...new Set(body.oneShotFileIds ?? [])]
    if ((!body.content?.trim() && !attachments.length) || oneShot.some((id) => !attachments.includes(id))) throw new BadRequestException('요청 내용 또는 첨부가 올바르지 않습니다')
    const existing = await this.db.select().from(chatRequest).where(and(eq(chatRequest.threadId, threadId), eq(chatRequest.idempotencyKey, key)))
    if (existing[0]) return this.replay(existing[0])
    let acquired: { id: string; replyMessageId: string; userMessageId: string; taskId?: string | null; deadlineAt?: number; firstTokenMs?: number; duplicate?: boolean; autoStarted?: boolean; staged?: StagedFile[] }
    try {
      acquired = await this.db.transaction(async (tx) => {
        await this.lockGlobalCapacity(tx)
        const owner = await this.lockedOwner(tx, threadId)
        const [duplicate] = await tx.select().from(chatRequest).where(and(eq(chatRequest.threadId, threadId), eq(chatRequest.idempotencyKey, key)))
        if (duplicate) return { id: duplicate.id, replyMessageId: duplicate.replyMessageId, userMessageId: duplicate.userMessageId, duplicate: true }
        const [active] = await tx.select({ id: chatRequest.id }).from(chatRequest).where(and(eq(chatRequest.threadId, threadId), inArray(chatRequest.status, ACTIVE)))
        if (active) throw new ConflictException({ code: 'REQUEST_ACTIVE' })
        await this.assertGlobalCapacity(tx)
        const [attachmentSetting] = await tx.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'fileMaxPerRequest'))
        if (attachments.length > (typeof attachmentSetting?.value === 'number' ? attachmentSetting.value : this.config.fileMaxPerRequest)) throw new HttpException({ code: 'ATTACHMENT_LIMIT' }, 413)
        if (attachments.length) {
          const valid = await tx.select({ id: fileObject.id }).from(fileObject).where(and(inArray(fileObject.id, attachments), owner.srId ? eq(fileObject.originSrId, owner.srId) : eq(fileObject.originTaskId, owner.taskId!), isNull(fileObject.deletedAt)))
          if (valid.length !== attachments.length) throw new BadRequestException('첨부 파일이 이 대화에 없습니다')
        }
        const [max] = await tx.select({ seq: sql<number>`coalesce(max(${message.seq}), 0)` }).from(message).where(eq(message.threadId, threadId))
        const seq = Number(max?.seq ?? 0)
        const userMessageId = randomUUID(), replyMessageId = randomUUID(), requestId = randomUUID()
        await tx.insert(message).values([{ id: userMessageId, threadId, seq: seq + 1, role: 'user', content: body.content.trim(), authorId: actor, status: 'done' },
          { id: replyMessageId, threadId, seq: seq + 2, role: 'assistant', content: '', status: 'streaming' }])
        if (attachments.length) await tx.insert(messageAttachment).values(attachments.map((fileId) => ({ messageId: userMessageId, fileId })))
        // 보낼 자료(스테이징)는 이 요청이 소비한다 — 같은 트랜잭션에서 읽고 비운다. 첨부는 모두 이번 요청에만(oneShot)
        let staged: StagedFile[] = attachments.map(fileId => ({ fileId, weight: 'reference', oneShot: true }))
        if (owner.taskId) {
          const selected = await tx.select({ fileId: taskInput.fileId, weight: taskInput.weight }).from(taskInput).where(eq(taskInput.taskId, owner.taskId)).orderBy(taskInput.sortOrder)
          staged = [...mainFirst(selected).map((item) => ({ fileId: item.fileId, weight: item.weight as StagedFile['weight'], oneShot: false })),
            ...attachments.filter((fileId) => !selected.some((item) => item.fileId === fileId)).map((fileId) => ({ fileId, weight: 'reference' as const, oneShot: true }))]
          if (selected.length) await tx.delete(taskInput).where(eq(taskInput.taskId, owner.taskId))
          await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, owner.taskId))
        }
        const firstTokenMs = this.firstTokenMs(attachments.length > 0 || staged.length > 0)
        const deadlineAt = Date.now() + firstTokenMs
        const [currentTask] = owner.taskId ? await tx.select().from(task).where(eq(task.id, owner.taskId)) : []
        const [currentAssistant] = currentTask ? await tx.select().from(assistant).where(eq(assistant.id, currentTask.assistantId)) : []
        const [budgetSetting] = await tx.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'requestBudgetBytes'))
        const limitBytes = typeof budgetSetting?.value === 'number' ? budgetSetting.value : this.config.request.budgetBytes
        const [deliverySetting] = await tx.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'fileDelivery'))
        await tx.insert(chatRequest).values({ id: requestId, threadId, userMessageId, replyMessageId, requestedBy: actor, idempotencyKey: key,
          status: 'pending', provider: this.config.llm.mode, transport: this.config.llm.mode === 'live' && (deliverySetting?.value ?? (this.config.llm.preset === 'openwebui' ? 'openwebui' : 'inline')) === 'openwebui' ? 'openwebui' : 'inline',
          model: owner.modelId ?? currentTask?.modelId ?? currentAssistant?.modelId ?? await readEffectiveDefaultModel(tx as Db, this.config),
          bytes: 0, limitBytes, leaseUntil: dbLeaseUntil(this.config.request.leaseMs) })
        await this.recordStaged(tx, requestId, staged)
        if (owner.taskId) {
          const conversations = await tx.select().from(conversationInput).where(eq(conversationInput.taskId, owner.taskId)).orderBy(conversationInput.selectedAt, conversationInput.id)
          if (conversations.length) {
            await tx.insert(chatRequestInput).values(mainFirst(conversations).map((item, index) => ({ requestId, seq: staged.length + index,
              kind: 'conversation', sourceTaskId: item.sourceTaskId, snapshotId: item.snapshotId, mode: item.mode, weight: item.weight })))
            await tx.delete(conversationInput).where(eq(conversationInput.taskId, owner.taskId))
          }
        }
        if (owner.taskId) {
          const selected = await tx.select().from(srInput).where(eq(srInput.taskId, owner.taskId))
          if (selected.length) {
            const linked = await linkedTaskSrs(tx as Db, actor, owner.taskId)
            const captured = linked.filter(sr => selected.some(item => item.srId === sr.id))
            const [last] = await tx.select({ seq: sql<number>`coalesce(max(${chatRequestInput.seq}), -1)` }).from(chatRequestInput).where(eq(chatRequestInput.requestId, requestId))
            if (captured.length) await tx.insert(chatRequestInput).values(captured.map((sr, index) => ({ requestId, seq: Number(last?.seq ?? -1) + 1 + index,
              kind: 'sr', weight: 'reference', srId: sr.id, sourceLabel: `${sr.code ?? ''} ${sr.title}`, oneShot: true,
              srSnapshot: { id: sr.id, code: sr.code ?? '', title: sr.title, body: sr.body } })))
            await tx.delete(srInput).where(eq(srInput.taskId, owner.taskId))
          }
        }
        await tx.insert(activityLog).values({ id: randomUUID(), type: 'message.sent', userId: actor, taskId: owner.taskId, srId: owner.srId, payload: { requestId } })
        await tx.insert(activityLog).values({ id: randomUUID(), type: 'request.started', userId: actor, taskId: owner.taskId, srId: owner.srId, payload: { requestId } })
        const autoStarted = await resumeHeldTask(tx, currentTask, actor)
        return { id: requestId, replyMessageId, userMessageId, taskId: owner.taskId, deadlineAt, firstTokenMs, autoStarted, staged }
      })
    } catch (error) {
      if (isDuplicateKey(error) && await this.hasActiveOrKey(threadId, key)) throw new ConflictException({ code: 'REQUEST_ACTIVE' })
      throw error
    }
    if (acquired.duplicate) return this.replay(await this.getRow(acquired.id))
    if (acquired.taskId) {
      if (acquired.autoStarted) this.appEvents?.publish('task.updated', { taskId: acquired.taskId })
      this.appEvents?.publish('message.appended', { threadId, taskId: acquired.taskId, messageId: acquired.userMessageId })
      this.appEvents?.publish('message.appended', { threadId, taskId: acquired.taskId, messageId: acquired.replyMessageId })
      // 스테이징 소비·'쓴 적 있음' 표시가 바뀌었다
      this.appEvents?.publish('input.updated', { taskId: acquired.taskId })
      this.appEvents?.publish('context.updated', { taskId: acquired.taskId })
    }
    this.appEvents?.publish('request.updated', { requestId: acquired.id, threadId, taskId: acquired.taskId ?? null, status: 'pending', phase: null })
    const limits = { firstTokenMs: acquired.firstTokenMs!, idleMs: this.config.request.idleMs, maxMs: this.config.request.maxMs }
    this.limits.set(acquired.id, limits)
    this.emit(acquired.id, { event: 'started', data: { requestId: acquired.id, replyMessageId: acquired.replyMessageId, userMessageId: acquired.userMessageId, createdAt: new Date().toISOString(), autoStarted: acquired.autoStarted ?? false, ...limits } })
    const done = this.run(acquired.id, acquired.staged ?? [], [], acquired.deadlineAt!)
    return { ...acquired, done }
  }

  async retry(actor: string, requestId: string, body: RetryBody, key: string): Promise<StartedRequest> {
    const [originalThread] = await this.db.select({ threadId: chatRequest.threadId }).from(chatRequest).where(eq(chatRequest.id, requestId))
    if (originalThread) await assertThreadAccess(this.db, actor, originalThread.threadId)
    if (!key?.trim()) throw new BadRequestException('Idempotency-Key가 필요합니다')
    if ([...key].length > 191) throw new BadRequestException('Idempotency-Key가 너무 깁니다')
    const original = await this.getRow(requestId)
    const duplicate = await this.db.select().from(chatRequest).where(and(eq(chatRequest.threadId, original.threadId), eq(chatRequest.idempotencyKey, key)))
    if (duplicate[0]) return this.replay(duplicate[0])
    if (!['failed', 'cancelled', 'interrupted'].includes(original.status)) throw new ConflictException({ code: 'NOT_FAILED' })
    const exclude = [...new Set(body.excludeFileIds ?? [])], inline = [...new Set(body.forceInlineFileIds ?? [])]
    const acquired = await this.db.transaction(async (tx) => {
      await this.lockGlobalCapacity(tx)
      const owner = await this.lockedOwner(tx, original.threadId)
      const [duplicate] = await tx.select().from(chatRequest).where(and(eq(chatRequest.threadId, original.threadId), eq(chatRequest.idempotencyKey, key)))
      if (duplicate) return { id: duplicate.id, replyMessageId: duplicate.replyMessageId, userMessageId: duplicate.userMessageId, staged: [] as StagedFile[], duplicate: true }
      const [latest] = await tx.select().from(message).where(and(eq(message.threadId, original.threadId), isNull(message.kind))).orderBy(desc(message.seq)).limit(1)
      if (latest?.id !== original.replyMessageId) throw new ConflictException({ code: 'NOT_LATEST' })
      const [active] = await tx.select().from(chatRequest).where(and(eq(chatRequest.threadId, original.threadId), inArray(chatRequest.status, ACTIVE)))
      if (active) throw new ConflictException({ code: 'REQUEST_ACTIVE' })
      await this.assertGlobalCapacity(tx)
      // 재시도는 원래 요청이 시작 때 기록한 자료(스테이징·첨부) 기준 — 지금 담아 둔 자료(다음 질문 몫)는 쓰지도 비우지도 않는다
      const files = original.retryOf ? [] : await tx.select().from(messageAttachment).where(eq(messageAttachment.messageId, original.userMessageId))
      const recorded = (await tx.select().from(chatRequestInput).where(and(eq(chatRequestInput.requestId, original.id), eq(chatRequestInput.kind, 'file'))).orderBy(chatRequestInput.seq))
        .flatMap((item): StagedFile[] => item.fileId ? [{ fileId: item.fileId, weight: item.weight as StagedFile['weight'], oneShot: item.oneShot }] : [])
      const snapshot = [...recorded, ...files.filter((item) => !recorded.some((input) => input.fileId === item.fileId)).map((item) => ({ fileId: item.fileId, weight: 'reference' as const, oneShot: true }))]
      const firstTokenMs = this.firstTokenMs(snapshot.length > 0)
      const deadlineAt = Date.now() + firstTokenMs
      const selectable = new Set(snapshot.map((item) => item.fileId))
      if (exclude.some((id) => !selectable.has(id)) || inline.some((id) => !selectable.has(id) || exclude.includes(id))) throw new BadRequestException('재시도 파일 ID가 올바르지 않습니다')
      if (inline.length) {
        const rows = await tx.select().from(fileObject).where(inArray(fileObject.id, inline))
        if (inline.some((id) => !selectable.has(id)) || rows.length !== inline.length || rows.some((row) => !/^(text\/|application\/(json|xml))/.test(row.mime))) throw new BadRequestException('텍스트 파일만 본문으로 보낼 수 있습니다')
      }
      const [max] = await tx.select({ seq: sql<number>`coalesce(max(${message.seq}), 0)` }).from(message).where(eq(message.threadId, original.threadId))
      const replyMessageId = randomUUID(), id = randomUUID()
      const [budgetSetting] = await tx.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'requestBudgetBytes'))
      const limitBytes = typeof budgetSetting?.value === 'number' ? budgetSetting.value : this.config.request.budgetBytes
      const [deliverySetting] = await tx.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'fileDelivery'))
      await tx.insert(message).values({ id: replyMessageId, threadId: original.threadId, seq: Number(max?.seq ?? 0) + 1, role: 'assistant', content: '', status: 'streaming' })
      await tx.insert(chatRequest).values({ id, threadId: original.threadId, userMessageId: original.userMessageId, replyMessageId, requestedBy: actor,
        retryOf: original.id, idempotencyKey: key, status: 'pending', provider: this.config.llm.mode,
        transport: this.config.llm.mode === 'live' && (deliverySetting?.value ?? (this.config.llm.preset === 'openwebui' ? 'openwebui' : 'inline')) === 'openwebui' ? 'openwebui' : 'inline',
        model: original.model, bytes: 0, limitBytes, leaseUntil: dbLeaseUntil(this.config.request.leaseMs) })
      const staged = snapshot.filter((item) => !exclude.includes(item.fileId))
      await this.recordStaged(tx, id, staged)
      const conversations = await tx.select().from(chatRequestInput).where(and(eq(chatRequestInput.requestId, original.id), eq(chatRequestInput.kind, 'conversation'))).orderBy(chatRequestInput.seq)
      if (conversations.length) await tx.insert(chatRequestInput).values(conversations.map((item, index) => ({ requestId: id, seq: staged.length + index,
        kind: 'conversation', sourceTaskId: item.sourceTaskId, snapshotId: item.snapshotId, mode: item.mode, weight: item.weight })))
      const srs = await tx.select().from(chatRequestInput).where(and(eq(chatRequestInput.requestId, original.id), eq(chatRequestInput.kind, 'sr'))).orderBy(chatRequestInput.seq)
      if (srs.length) await tx.insert(chatRequestInput).values(srs.map((item, index) => ({ ...item, requestId: id, seq: staged.length + conversations.length + index })))
      await tx.insert(activityLog).values({ id: randomUUID(), type: 'request.started', userId: actor, taskId: owner.taskId, srId: owner.srId, payload: { requestId: id, retryOf: original.id } })
      const [currentTask] = owner.taskId ? await tx.select().from(task).where(eq(task.id, owner.taskId)) : []
      const autoStarted = await resumeHeldTask(tx, currentTask, actor)
      if (owner.taskId) await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, owner.taskId))
      return { id, replyMessageId, userMessageId: original.userMessageId, taskId: owner.taskId, deadlineAt, firstTokenMs, autoStarted, staged }
    }).catch(async (error: unknown) => {
      if (isDuplicateKey(error) && await this.hasActiveOrKey(original.threadId, key)) throw new ConflictException({ code: 'REQUEST_ACTIVE' })
      throw error
    })
    if (acquired.duplicate) return this.replay(await this.getRow(acquired.id))
    if (acquired.taskId) {
      if (acquired.autoStarted) this.appEvents?.publish('task.updated', { taskId: acquired.taskId })
      this.appEvents?.publish('message.appended', { threadId: original.threadId, taskId: acquired.taskId, messageId: acquired.replyMessageId })
    }
    this.appEvents?.publish('request.updated', { requestId: acquired.id, threadId: original.threadId,
      taskId: acquired.taskId ?? null, status: 'pending', phase: null })
    const limits = { firstTokenMs: acquired.firstTokenMs!, idleMs: this.config.request.idleMs, maxMs: this.config.request.maxMs }
    this.limits.set(acquired.id, limits)
    this.emit(acquired.id, { event: 'started', data: { requestId: acquired.id, replyMessageId: acquired.replyMessageId, userMessageId: acquired.userMessageId, createdAt: new Date().toISOString(), autoStarted: acquired.autoStarted ?? false, ...limits } })
    return { ...acquired, done: this.run(acquired.id, acquired.staged, inline, acquired.deadlineAt!) }
  }

  /** 첫 응답 제한 — 파일 자료가 있으면 업로드·처리 시간을 감안해 더 길다 */
  private firstTokenMs(files: boolean) {
    return files ? this.config.request.filesFirstTokenMs : this.config.request.firstTokenMs
  }

  private async getRow(id: string) {
    const [row] = await this.db.select().from(chatRequest).where(eq(chatRequest.id, id))
    if (!row) throw new NotFoundException('요청을 찾을 수 없습니다')
    return row
  }
  async get(id: string, actor?: string) {
    const row = await this.getRow(id)
    if (actor) await assertThreadAccess(this.db, actor, row.threadId)
    const inputs = await this.db.select().from(chatRequestInput).where(eq(chatRequestInput.requestId, id)).orderBy(chatRequestInput.seq)
    const savedSnapshot = row.snapshot as { webPages?: RequestInfo['webPages'] } | null
    const limits = this.limits.get(id) ?? { firstTokenMs: this.firstTokenMs(inputs.some((item) => item.kind === 'file')), idleMs: this.config.request.idleMs, maxMs: this.config.request.maxMs }
    return { id: row.id, threadId: row.threadId, status: row.status, ...limits, ...(savedSnapshot?.webPages ? { webPages: savedSnapshot.webPages } : {}), phase: row.phase, code: errorCode(row.status, row.error, row.bytes), provider: row.provider, transport: row.transport, owuiTools: row.owuiTools,
      model: row.model, bytes: row.status === 'pending' && row.bytes === 0 ? null : row.bytes, limitBytes: row.limitBytes, error: row.error, retryOf: row.retryOf, createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString(), hasSnapshot: row.snapshot !== null, inputs: inputs.map((item) => ({ kind: item.kind, weight: item.weight, fileId: item.fileId,
        fileVersion: item.fileVersion, srId: item.srId, srCode: item.srSnapshot?.code, srTitle: item.srSnapshot?.title, sourceLabel: item.sourceLabel, oneShot: item.oneShot, delivery: item.delivery, sourceTaskId: item.sourceTaskId,
        snapshotId: item.snapshotId, mode: item.mode, messageCount: item.messageCount, bytes: item.bytes, error: item.error })) }
  }
  async snapshot(id: string, actor?: string) {
    const row = await this.getRow(id)
    if (actor) await assertThreadAccess(this.db, actor, row.threadId)
    const value = row.snapshot as Record<string, unknown> | null
    if (typeof value?.storageKey === 'string') return JSON.parse(Buffer.from(await this.storage.read(value.storageKey)).toString('utf8')) as unknown
    if (!value) throw new NotFoundException('원본 요청이 없습니다')
    return value
  }

  private async saveBuilt(id: string, info: RequestInfo): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updated = await tx.update(chatRequest).set({ provider: info.provider, transport: info.transport, model: info.model,
        bytes: info.bytes, limitBytes: info.limitBytes, phase: null, ...(info.webPages?.length ? { snapshot: { webPages: info.webPages } } : {}) }).where(and(eq(chatRequest.id, id), eq(chatRequest.status, 'pending')))
      if (!updated[0].affectedRows) return false
      // 시작 때 남긴 자료 기록(recordStaged)을 실제 조립 결과로 바꾼다
      const recordedSrs = await tx.select().from(chatRequestInput).where(and(eq(chatRequestInput.requestId, id), eq(chatRequestInput.kind, 'sr')))
      await tx.delete(chatRequestInput).where(eq(chatRequestInput.requestId, id))
      if (info.inputs.length) await tx.insert(chatRequestInput).values(info.inputs.map((item: RequestInput, seq) => ({ requestId: id, seq, kind: item.kind, weight: item.weight,
        fileId: item.kind === 'file' ? item.fileId : null, fileVersion: item.kind === 'file' ? item.version : null,
        sourceLabel: item.kind === 'file' ? `${item.name}${item.source ? ` · ${item.source}` : ''}` : item.kind === 'sr' ? `${item.code} ${item.title}` : item.code, oneShot: item.kind === 'file' ? !!item.oneShot : item.kind === 'sr',
        srId: item.kind === 'sr' ? item.srId : null, srSnapshot: item.kind === 'sr' ? recordedSrs.find(row => row.srId === item.srId)?.srSnapshot : null,
        delivery: item.kind === 'file' ? item.delivery : null, remoteId: item.kind === 'file' ? item.remoteId : null,
        sourceTaskId: item.kind === 'conversation' ? item.sourceTaskId : null, snapshotId: item.kind === 'conversation' ? item.snapshotId : null,
        mode: item.kind === 'conversation' ? item.mode : null, messageCount: item.kind === 'conversation' ? item.messageCount : null,
        bytes: item.bytes, error: item.kind === 'file' ? item.error : null })))
      return true
    })
  }

  /** 요청 시작 때 소비한 파일 자료를 기록한다 — 조립 전에 실패·중단돼도 재시도가 이 기준으로 된다. 조립되면 saveBuilt가 실제 결과로 바꾼다 */
  private async recordStaged(tx: Tx, requestId: string, staged: StagedFile[]) {
    if (!staged.length) return
    const rows = await tx.select({ id: fileObject.id, name: fileObject.originalName, version: fileObject.version }).from(fileObject).where(inArray(fileObject.id, staged.map((item) => item.fileId)))
    await tx.insert(chatRequestInput).values(staged.map((item, seq) => ({ requestId, seq, kind: 'file', weight: item.weight, fileId: item.fileId, oneShot: item.oneShot,
      fileVersion: rows.find((row) => row.id === item.fileId)?.version ?? null, sourceLabel: rows.find((row) => row.id === item.fileId)?.name ?? null })))
  }

  private async transition(id: string, status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted', error?: string, content?: string,
    info?: RequestInfo, snapshot?: unknown, expired = false): Promise<boolean> {
    const row = await this.getRow(id)
    try { const changed = await this.db.transaction(async (tx) => {
      const owner = await this.lockedOwner(tx, row.threadId).catch((e) => { if (e instanceof ConflictException && status !== 'succeeded') return undefined; throw e })
      const updated = await tx.update(chatRequest).set({ status, error: error ?? null, finishedAt: new Date(), phase: null,
        snapshot: snapshot ?? row.snapshot, leaseUntil: null }).where(and(eq(chatRequest.id, id), inArray(chatRequest.status, ACTIVE), ...(expired ? [lt(chatRequest.leaseUntil, sql`current_timestamp(6)`)] : [])))
      if (!updated[0].affectedRows) return false
      const reply = await tx.update(message).set({ status: status === 'succeeded' ? 'done' : 'error', error: error ?? null,
        ...(content !== undefined ? { content: content || (error ? `⚠️ ${error}` : '') } : {}),
        ...(this.streamReasoning.has(id) ? { reasoning: this.streamReasoning.get(id) } : {}) }).where(and(eq(message.id, row.replyMessageId), eq(message.status, 'streaming')))
      if (!reply[0].affectedRows) throw new FencedTransition()
      if (owner?.taskId) await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, owner.taskId))
      await tx.insert(activityLog).values({ id: randomUUID(), type: `request.${status === 'succeeded' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed'}`,
        userId: row.requestedBy, taskId: owner?.taskId ?? null, srId: owner?.srId ?? null, payload: { requestId: id, bytes: info?.bytes ?? row.bytes, model: info?.model ?? row.model } })
      return true
    })
      if (changed) this.appEvents?.publish('request.updated', { requestId: id, threadId: row.threadId,
        taskId: (await this.db.select({ taskId: thread.taskId }).from(thread).where(eq(thread.id, row.threadId)))[0]?.taskId ?? null,
        status, phase: null })
      return changed
    } catch (caught) { if (caught instanceof FencedTransition) return false; throw caught }
  }

  async cancel(id: string, actor?: string): Promise<void> {
    const row = await this.getRow(id)
    if (actor) await assertThreadAccess(this.db, actor, row.threadId)
    if (!ACTIVE.includes(row.status)) return
    if (await this.transition(id, 'cancelled', STOPPED)) {
      this.runs.get(id)?.abort('cancelled')
      this.emit(id, { event: 'failed', data: { error: STOPPED, code: 'CANCELLED', requestInfo: await this.get(id) } })
    }
  }

  async sweep(): Promise<number> {
    const expired = await this.db.select({ id: chatRequest.id }).from(chatRequest).where(and(inArray(chatRequest.status, ACTIVE), lt(chatRequest.leaseUntil, sql`current_timestamp(6)`)))
    let count = 0
    for (const row of expired) if (await this.transition(row.id, 'interrupted', STALE, undefined, undefined, undefined, true)) {
      count++
      this.runs.get(row.id)?.abort('lost')
      this.emit(row.id, { event: 'failed', data: { error: STALE, code: 'INTERRUPTED', requestInfo: await this.get(row.id) } })
    }
    return count
  }

  async recoverOnStartup(): Promise<number> {
    const pending = await this.db.select({ id: chatRequest.id }).from(chatRequest).where(inArray(chatRequest.status, ACTIVE))
    let count = 0
    for (const row of pending) if (!this.runs.has(row.id) && await this.transition(row.id, 'interrupted', STALE)) count++
    return count
  }

  private async run(id: string, staged: StagedFile[], forceInline: string[], deadlineAt: number): Promise<void> {
    const controller = new AbortController()
    this.runs.set(id, controller)
    let timer: ReturnType<typeof setTimeout> | undefined
    let rejectDeadline: ((error: Error) => void) | undefined
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject })
    void deadline.catch(() => undefined)
    const stopped = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('요청 중지')), { once: true }))
    void stopped.catch(() => undefined)
    const arm = (ms: number) => { if (timer) clearTimeout(timer); timer = setTimeout(() => {
      controller.abort('timeout'); rejectDeadline?.(new Error(TIMEOUT))
    }, ms) }
    arm(Math.max(1, deadlineAt - Date.now()))
    // 최대 처리 시간 — 세션 모드는 OpenWebUI 작업이 살아 있으면 무응답 제한을 계속 다시 걸므로 이것이 상한이다
    let capped = false
    const cap = setTimeout(() => { capped = true; controller.abort('timeout'); rejectDeadline?.(new Error(TIMEOUT)) }, this.config.request.maxMs)
    cap.unref?.()
    const lease = setInterval(() => { void this.db.update(chatRequest).set({ leaseUntil: dbLeaseUntil(this.config.request.leaseMs) })
      .where(and(eq(chatRequest.id, id), inArray(chatRequest.status, ACTIVE)))
      .then((result) => { if (!result[0].affectedRows) controller.abort('lost') }).catch(() => controller.abort('lost')) }, this.config.request.keepaliveMs)
    lease.unref?.()
    let acc = '', reasoning = '', phase = '', info: RequestInfo | undefined, snapshot: unknown, snapshotBytes: Buffer | undefined, failure: string | undefined
    let dirty = false
    let replyId = ''
    const flush = async () => {
      if (!dirty || !replyId || controller.signal.aborted) return
      dirty = false
      const content = acc
      const updated = await this.db.update(message).set({ content, reasoning: reasoning || null }).where(and(eq(message.id, replyId), eq(message.status, 'streaming')))
      if (!updated[0].affectedRows) controller.abort('lost')
    }
    const flushTimer = setInterval(() => { void flush().catch(() => controller.abort('lost')) }, this.config.request.flushMs)
    flushTimer.unref?.()
    try {
      const row = await this.getRow(id)
      replyId = row.replyMessageId
      const ports = new DbLlmPorts(this.db, this.config, row.requestedBy, this.storage)
      const [owner] = await this.db.select().from(thread).where(eq(thread.id, row.threadId))
      if (!owner) throw new Error('스레드를 찾을 수 없습니다')
      const scope = await this.scope(owner, ports)
      const all = await this.db.select().from(message).where(eq(message.threadId, row.threadId)).orderBy(message.seq)
      const user = all.find((item) => item.id === row.userMessageId)
      const history: Message[] = all.filter((item) => item.seq <= (user?.seq ?? 0)).map((item) => ({ id: item.id, threadId: item.threadId,
        role: item.role as Message['role'], content: item.content, authorId: item.authorId ?? undefined, createdAt: item.createdAt.toISOString(),
        attachmentIds: [], status: item.status as Message['status'], kind: item.kind as Message['kind'] }))
      const domainThread: Thread = { id: owner.id, ...(owner.taskId ? { taskId: owner.taskId } : { srId: owner.srId! }), title: owner.title,
        createdBy: owner.createdBy, createdAt: owner.createdAt.toISOString(), archived: false, ...(owner.modelId ? { modelId: owner.modelId } : {}) }
      if (controller.signal.aborted) throw new Error('요청 시간 초과')
      const recorded = await this.db.select().from(chatRequestInput).where(and(eq(chatRequestInput.requestId, id), eq(chatRequestInput.kind, 'conversation'))).orderBy(chatRequestInput.seq)
      const loaded = owner.taskId ? await new DbConversationInputsService(this.db).load(owner.taskId, undefined,
        recorded.flatMap(item => item.snapshotId && item.sourceTaskId ? [{ snapshotId: item.snapshotId, sourceTaskId: item.sourceTaskId, weight: item.weight as 'main' | 'reference' }] : [])) : []
      const sources = await ports.getTasks(loaded.map(item => item.input.sourceTaskId))
      const assistants = await ports.getAssistants()
      const conversations = loaded.map((item, index) => {
        const source = sources[index]
        if (!source) throw new Error('참조 대화 기록을 찾을 수 없습니다')
        return { input: item.input, snapshot: item.snapshot, messages: item.messages, source, assistant: assistants.find(agent => agent.id === source.assistantId) }
      })
      const srRecords = await this.db.select().from(chatRequestInput).where(and(eq(chatRequestInput.requestId, id), eq(chatRequestInput.kind, 'sr'))).orderBy(chatRequestInput.seq)
      const srs = srRecords.map(item => { if (!item.srSnapshot) throw new Error('SR 본문 기록을 찾을 수 없습니다'); return item.srSnapshot })
      const built = await Promise.race([buildChatRequest(scope, domainThread, history, { conversations, srs, inputs: staged.filter((item) => !item.oneShot),
        oneShotFileIds: staged.filter((item) => item.oneShot).map((item) => item.fileId), forceInlineFileIds: forceInline,
        deadlineAt,
        onWebProgress: (host) => {
          const phase = `🔗 페이지 읽는 중(${host})`
          this.emit(id, { event: 'phase', data: { text: phase } })
          void this.db.update(chatRequest).set({ phase }).where(and(eq(chatRequest.id, id), inArray(chatRequest.status, ACTIVE)))
            .then(result => { if (result[0].affectedRows) this.appEvents?.publish('request.updated', { requestId: id, threadId: row.threadId, taskId: owner.taskId, status: 'pending', phase }) }).catch(() => undefined)
        },
        signal: controller.signal, onProgress: (progress) => { const phase = `${progress.phase === 'uploading' ? '파일 올리는 중' : '파일 처리 대기'} ${progress.index + 1}/${progress.total} · ${progress.name}`
          void this.db.update(chatRequest).set({ phase }).where(and(eq(chatRequest.id, id), inArray(chatRequest.status, ACTIVE)))
            .then((result) => { if (result[0].affectedRows) this.appEvents?.publish('request.updated', { requestId: id,
              threadId: row.threadId, taskId: owner.taskId, status: 'pending', phase }) }).catch(() => undefined)
          this.emit(id, { event: 'phase', data: { text: phase } }) } }, ports), deadline, stopped])
      info = { ...built.info, ...(row.retryOf ? { retryOf: row.retryOf } : {}) }
      if (!(await this.saveBuilt(id, info))) { controller.abort('lost'); return }
      if (built.failed.length) { failure = `파일 ${built.failed.length}개(${built.failed.map((item) => item.name).join(', ')})를 OpenWebUI에 전달하지 못해 요청을 보내지 않았습니다.`; return }
      if (info.bytes > info.limitBytes) { failure = `요청 크기 한도 초과 (${Math.ceil(info.bytes / 1024)} KB / ${Math.ceil(info.limitBytes / 1024)} KB)`; return }
      const recordSnapshot = (extras: Record<string, unknown> = {}) => {
        snapshot = { sentAt: new Date().toISOString(), provider: this.provider.kind, model: built.model, meta: built.meta,
          messages: built.messages, ...(info?.webPages?.length ? { webPages: info.webPages } : {}), stream: true, ...extras, ...(built.files?.length && { files: built.info.inputs.flatMap((input) => input.kind === 'file' && input.delivery === 'attached'
            ? [{ type: 'file', fileId: input.fileId }] : []) }) }
        const serialized = Buffer.from(JSON.stringify(snapshot))
        snapshotBytes = undefined
        if (serialized.byteLength > 1024 * 1024) {
          const now = new Date(), key = `requests/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.json`
          snapshotBytes = serialized
          snapshot = { storageKey: key, ...(info?.webPages?.length ? { webPages: info.webPages } : {}) }
        }
      }
      recordSnapshot()
      // 실제 마지막 전송의 기록 — 세션 모드(S12)면 채팅 ID를 나중에 더한다
      let sent: Record<string, unknown> = {}
      const owuiLive = this.config.llm.mode === 'live' && this.config.llm.preset === 'openwebui'
      const setPhase = async (next: string) => {
        if (phase === next) return true
        phase = next
        const updated = await this.db.update(chatRequest).set({ phase }).where(and(eq(chatRequest.id, id), inArray(chatRequest.status, ACTIVE)))
        if (!updated[0].affectedRows || controller.signal.aborted) { controller.abort('lost'); return false }
        this.appEvents?.publish('request.updated', { requestId: id, threadId: row.threadId, taskId: owner.taskId, status: 'streaming', phase })
        this.emit(id, { event: 'phase', data: { text: phase } })
        return true
      }
      if (controller.signal.aborted) return
      const streaming = await this.db.update(chatRequest).set({ status: 'streaming' }).where(and(eq(chatRequest.id, id), eq(chatRequest.status, 'pending')))
      if (!streaming[0].affectedRows) { controller.abort('lost'); return }
      this.appEvents?.publish('request.updated', { requestId: id, threadId: row.threadId, taskId: owner.taskId, status: 'streaming', phase: null })
      const iterator = this.provider.stream({ model: built.model, messages: built.messages, files: built.files, meta: built.meta, signal: controller.signal,
        owuiTools: built.settings.llm.owuiTools, owuiMode: built.settings.llm.owuiMode, owuiCleanup: built.settings.llm.owuiCleanup,
        onDispatch: async (delivery, body) => {
          if (controller.signal.aborted) throw new Error('요청 중지')
          if (info && owuiLive) {
            info.owuiTools = delivery
            const updated = await this.db.update(chatRequest).set({ owuiTools: delivery })
              .where(and(eq(chatRequest.id, id), inArray(chatRequest.status, ACTIVE)))
            if (!updated[0].affectedRows) { controller.abort('lost'); throw new Error('요청 중지') }
          }
          const session = typeof body.session_id === 'string'
          // 모델 기본값(owuiDefaults — 도구·스킬·필터·기능·터미널)은 실제 본문에 실린 것만 남긴다
          const defaults = Object.fromEntries(OWUI_DEFAULT_KEYS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]))
          sent = { ...defaults, ...(delivery.mode === 'tools' || session ? { params: body.params } : {}), ...(owuiLive ? { mode: session ? 'session' : 'direct' } : {}) }
          recordSnapshot(sent)
        },
        onSession: (chatId) => { sent = { ...sent, chat_id: chatId }; recordSnapshot(sent) } })[Symbol.asyncIterator]()
      for (;;) {
        const chunk = await Promise.race([iterator.next(), deadline, stopped])
        if (chunk.done) break
        if (controller.signal.aborted) break
        if (chunk.value.type === 'error') { failure = chunk.value.message; break }
        // 세션 모드 상태(도구 실행 등)는 진행 단계이자 생존 신호다
        if (chunk.value.type === 'status') {
          arm(this.config.request.idleMs)
          if (!(await setPhase(chunk.value.text))) break
          continue
        }
        if (chunk.value.type === 'replace') {
          arm(this.config.request.idleMs)
          if (!(await setPhase(chunk.value.field === 'reasoning' ? '생각 중' : '답변 중'))) break
          if (chunk.value.field === 'reasoning') { reasoning = chunk.value.text; this.streamReasoning.set(id, reasoning) }
          else { acc = chunk.value.text; this.streamText.set(id, acc) }
          // 재연결은 이미 보낸 delta를 재생하지 않고 바뀐 누적 본문으로 다시 시작한다(replay)
          this.truncated.add(id)
          dirty = true
          this.emit(id, { event: 'replace', data: { field: chunk.value.field, text: chunk.value.text } })
          continue
        }
        if ((chunk.value.type !== 'delta' && chunk.value.type !== 'reasoning') || !chunk.value.text) continue
        arm(this.config.request.idleMs)
        if (!(await setPhase(chunk.value.type === 'reasoning' ? '생각 중' : '답변 중'))) break
        if (chunk.value.type === 'reasoning') {
          reasoning += chunk.value.text
          this.streamReasoning.set(id, reasoning)
        } else {
          acc += chunk.value.text
          this.streamText.set(id, acc)
        }
        dirty = true
        this.emit(id, { event: chunk.value.type, data: { text: chunk.value.text } })
      }
    } catch (error) { failure = controller.signal.reason === 'timeout' ? TIMEOUT : this.safeError(error) }
    finally {
      if (timer) clearTimeout(timer)
      clearTimeout(cap)
      clearInterval(lease)
      clearInterval(flushTimer)
      if (controller.signal.reason === 'timeout') failure = capped ? `응답 시간 초과 — 최대 처리 시간(${maxLabel(this.config.request.maxMs)})을 넘었습니다.` : TIMEOUT
      try {
        if (controller.signal.reason !== 'lost' && controller.signal.reason !== 'cancelled') {
          let writtenKey: string | undefined
          if (snapshotBytes && snapshot && typeof snapshot === 'object' && 'storageKey' in snapshot && typeof snapshot.storageKey === 'string') {
            try { await this.storage.write(snapshot.storageKey, snapshotBytes); writtenKey = snapshot.storageKey }
            catch { snapshot = JSON.parse(snapshotBytes.toString('utf8')) as unknown }
          }
          let transitioned = false
          try {
            transitioned = await this.transition(id, failure ? 'failed' : 'succeeded', failure, acc, info, snapshot)
            if (transitioned) {
              this.emit(id, failure ? { event: 'failed', data: { error: failure, code: errorCode('failed', failure, info?.bytes ?? 0), requestInfo: publicInfo(info) } } : { event: 'completed', data: { requestInfo: publicInfo(info) } })
              if (!failure) void this.maybeTitle(id).catch(() => undefined)
            }
          } finally {
            if (writtenKey && !transitioned) await this.storage.remove(writtenKey)
          }
        }
      } finally { this.runs.delete(id) }
    }
  }

  private async maybeTitle(id: string) {
    const row = await this.getRow(id)
    const [owner] = await this.db.select().from(thread).where(eq(thread.id, row.threadId))
    if (!owner?.taskId) return
    const [current] = await this.db.select().from(task).where(eq(task.id, owner.taskId))
    if (current?.titleSource !== 'default') return
    const rows = await this.db.select().from(message).where(eq(message.threadId, owner.id)).orderBy(message.seq)
    const history: Message[] = rows.map((item) => ({ id: item.id, threadId: item.threadId, role: item.role as Message['role'], content: item.content,
      createdAt: item.createdAt.toISOString(), attachmentIds: [], status: item.status as Message['status'], kind: item.kind as Message['kind'] }))
    const title = await this.runAuxiliary(row.requestedBy, 'title', (signal) => suggestTitle(this.provider, row.model, history, signal))
    if (title) {
      const updated = await this.db.update(task).set({ title, titleSource: 'ai' }).where(and(eq(task.id, owner.taskId), eq(task.titleSource, 'default')))
      if (updated[0].affectedRows) this.appEvents?.publish('task.updated', { taskId: owner.taskId })
    }
  }
}
