import type { PreviousMaterial } from '@mes/contracts'
import { assertFileReadable, taskSrAttachments } from '../files/sr-attachments.js'
import { linkedTaskSrs } from '../tasks/sr-inputs.service.js'
import { randomUUID } from 'node:crypto'
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { byteLength, eligibleMessages, newMessagesSince, renderAnswer, type AnswerDetail, type AnswerStep, type ContextSnapshot, type ConversationInput, type Message } from '@mes/domain'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module.js'
import { EventsService } from '../events/events.service.js'
import { activityLog, appUser, assistant, chatRequest, chatRequestInput, contextSnapshot, contextSnapshotMessage, conversationInput, fileObject, message, tag, task, taskTag, thread } from '../db/schema.js'
import { assertTaskAccess } from '../sr/access.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Weight = 'main' | 'reference'
type Mode = 'full' | 'messages' | 'summary'
export interface SelectConversation { mode: Mode; snapshotId?: string; weight?: Weight; messageIds?: string[]; summary?: { text: string; source: 'ai' | 'rule'; model?: string; messageIds: string[] } }
const id = () => randomUUID()
const badIds = () => new BadRequestException({ code: 'INVALID_MESSAGE_IDS' })
const eligible = (rows: (typeof message.$inferSelect)[]): Message[] => eligibleMessages(rows.map((row) => ({
  id: row.id, threadId: row.threadId, seq: row.seq, role: row.role as Message['role'], kind: row.kind as Message['kind'], content: row.content, reasoning: row.reasoning, steps: row.steps,
  status: row.status as Message['status'], authorId: row.authorId ?? undefined, createdAt: row.createdAt.toISOString(), attachmentIds: [],
})))

/** 참고 대화로 보낼 때 이 메시지가 차지하는 크기 — renderConversation과 같은 규칙(사용자는 본문, AI 답변은 표시 모드의 단계 렌더) */
const messageBytes = (m: { role: string; content: string; reasoning?: string | null; steps?: AnswerStep[] | null }, detail: AnswerDetail) =>
  byteLength(m.role === 'user' ? m.content : renderAnswer(m, detail))

@Injectable()
export class DbConversationInputsService {
  constructor(@Inject(DB) private readonly db: Db, @Inject(EventsService) private readonly events?: EventsService) {}

  private async taskRow(taskId: string, tx: Db | Tx = this.db) {
    const [row] = await tx.select().from(task).where(and(eq(task.id, taskId), isNull(task.deletedAt)))
    if (!row) throw new NotFoundException('대화를 찾을 수 없습니다')
    return row
  }
  private async lockPair(tx: Tx, ids: string[]) {
    const rows = []
    for (const taskId of [...new Set(ids)].sort()) {
      const [row] = await tx.select().from(task).where(and(eq(task.id, taskId), isNull(task.deletedAt))).for('update')
      if (!row) throw new NotFoundException('대화를 찾을 수 없습니다')
      rows.push(row)
    }
    return rows
  }
  private async messages(sourceTaskId: string, tx: Db | Tx = this.db) {
    const [sourceThread] = await tx.select({ id: thread.id }).from(thread).where(eq(thread.taskId, sourceTaskId))
    if (!sourceThread) return []
    return eligible(await tx.select().from(message).where(eq(message.threadId, sourceThread.id)).orderBy(message.seq))
  }
  private async shared(taskId: string, sourceTaskId: string, tx: Db | Tx = this.db) {
    const mine = await tx.select({ key: taskTag.tagKey }).from(taskTag).where(eq(taskTag.taskId, taskId))
    if (!mine.length) return false
    const [match] = await tx.select({ key: taskTag.tagKey }).from(taskTag).where(and(eq(taskTag.taskId, sourceTaskId), inArray(taskTag.tagKey, mine.map((row) => row.key)))).limit(1)
    return !!match
  }

  async candidates(taskId: string, actor?: string) {
    if (actor) await assertTaskAccess(this.db, actor, taskId)
    await this.taskRow(taskId)
    const mine = await this.db.select({ key: taskTag.tagKey }).from(taskTag).where(eq(taskTag.taskId, taskId))
    if (!mine.length) return []
    const shared = await this.db.select({ sourceTaskId: taskTag.taskId, label: tag.label }).from(taskTag)
      .innerJoin(tag, eq(tag.key, taskTag.tagKey)).where(inArray(taskTag.tagKey, mine.map((row) => row.key)))
    const tags = new Map<string, string[]>()
    for (const row of shared) if (row.sourceTaskId !== taskId) tags.set(row.sourceTaskId, [...(tags.get(row.sourceTaskId) ?? []), row.label])
    if (!tags.size) return []
    const sources = await this.db.select({ source: task, assistant }).from(task).innerJoin(assistant, eq(assistant.id, task.assistantId))
      .where(and(inArray(task.id, [...tags.keys()]), isNull(task.deletedAt))).orderBy(desc(task.lastActivityAt))
    const [viewer] = actor ? await this.db.select({ isBusinessOwner: appUser.isBusinessOwner, isSystemOwner: appUser.isSystemOwner }).from(appUser).where(eq(appUser.id, actor)) : []
    const visibleSources = actor && viewer?.isBusinessOwner && !viewer.isSystemOwner ? (await Promise.all(sources.map(async (item) => {
      try { await assertTaskAccess(this.db, actor, item.source.id); return item }
      catch (error) { if (error instanceof ForbiddenException) return null; throw error }
    }))).filter((item): item is (typeof sources)[number] => item !== null) : sources
    const rows = visibleSources.length ? await this.db.select({ taskId: thread.taskId, role: message.role, content: message.content, reasoning: message.reasoning, steps: message.steps })
      .from(thread).innerJoin(message, eq(message.threadId, thread.id))
      .where(and(inArray(thread.taskId, visibleSources.map((item) => item.source.id)), inArray(message.role, ['user', 'assistant']),
        eq(message.status, 'done'), isNull(message.kind), sql`trim(${message.content}) <> ''`)) : []
    const countsByTask = new Map<string | null, { count: number; bytes: number; bytesFull: number }>()
    for (const row of rows) {
      const count = countsByTask.get(row.taskId) ?? { count: 0, bytes: 0, bytesFull: 0 }
      countsByTask.set(row.taskId, { count: count.count + 1, bytes: count.bytes + messageBytes(row, 'brief'), bytesFull: count.bytesFull + messageBytes(row, 'full') })
    }
    const used = await this.db.select({ sourceTaskId: chatRequestInput.sourceTaskId }).from(chatRequestInput)
      .innerJoin(chatRequest, eq(chatRequestInput.requestId, chatRequest.id)).innerJoin(thread, eq(chatRequest.threadId, thread.id))
      .where(and(eq(thread.taskId, taskId), eq(chatRequestInput.kind, 'conversation')))
    const usedSources = new Set(used.map(item => item.sourceTaskId))
    const selected = await this.db.select().from(conversationInput).where(eq(conversationInput.taskId, taskId))
    const loaded = await this.list(taskId)
    return visibleSources.map(({ source, assistant: agent }) => {
      const count = countsByTask.get(source.id)
      const choice = selected.find((row) => row.sourceTaskId === source.id)
      const detail = choice && loaded.find((row) => row.input.sourceTaskId === source.id)
      return { taskId: source.id, used: usedSources.has(source.id), code: source.code, title: source.title, status: source.status,
        assistant: { id: agent.id, name: agent.name, color: agent.color }, sharedTags: tags.get(source.id)!,
        messageCount: count?.count ?? 0, bytes: count?.bytes ?? 0, bytesFull: count?.bytesFull ?? 0, lastActivityAt: source.lastActivityAt.toISOString(),
        ...(detail && { selected: { weight: detail.input.weight, mode: detail.input.mode, snapshotId: detail.snapshot.id, newMessages: detail.newMessages, detached: detail.detached } }) }
    })
  }

  async load(taskId: string, actor?: string, captured?: Array<{ sourceTaskId: string; snapshotId: string; weight: Weight }>) {
    if (actor) await assertTaskAccess(this.db, actor, taskId)
    await this.taskRow(taskId)
    const rows = captured?.map(row => ({ ...row, id: row.snapshotId, taskId, mode: '', selectedBy: '', selectedAt: new Date(0) }))
      ?? await this.db.select().from(conversationInput).where(eq(conversationInput.taskId, taskId)).orderBy(conversationInput.selectedAt, conversationInput.id)
    return Promise.all(rows.map(async (row) => {
      if (actor) await assertTaskAccess(this.db, actor, row.sourceTaskId)
      const [snapshot] = await this.db.select().from(contextSnapshot).where(eq(contextSnapshot.id, row.snapshotId))
      const [source] = await this.db.select({ source: task, assistant }).from(task).innerJoin(assistant, eq(assistant.id, task.assistantId)).where(eq(task.id, row.sourceTaskId))
      if (!snapshot || !source) throw new NotFoundException('참조 대화 기록을 찾을 수 없습니다')
      const pinned = await this.db.select().from(contextSnapshotMessage).where(eq(contextSnapshotMessage.snapshotId, snapshot.id)).orderBy(contextSnapshotMessage.seq)
      const all = await this.messages(row.sourceTaskId)
      const boundary = all.find((item) => item.id === snapshot.upToMessageId)
      const selectedMessages = snapshot.mode === 'summary' ? [] : pinned.flatMap(({ messageId }) => all.find((item) => item.id === messageId) ?? [])
      const input: ConversationInput = { id: row.id, taskId: row.taskId, sourceTaskId: row.sourceTaskId, weight: row.weight as Weight,
        mode: snapshot.mode as Mode, snapshotId: row.snapshotId, selectedBy: row.selectedBy, selectedAt: row.selectedAt.toISOString() }
      const view: ContextSnapshot = { id: snapshot.id, sourceTaskId: snapshot.sourceTaskId, mode: snapshot.mode as Mode,
        messageIds: pinned.map((item) => item.messageId), ...(snapshot.upToMessageId && { upToMessageId: snapshot.upToMessageId }),
        ...(boundary && { upToCreatedAt: boundary.createdAt }), ...(snapshot.summaryText !== null && { summaryText: snapshot.summaryText }),
        ...(snapshot.summarySource && { summarySource: snapshot.summarySource as 'ai' | 'rule' }), ...(snapshot.summaryModel && { summaryModel: snapshot.summaryModel }),
        createdBy: snapshot.createdBy, createdAt: snapshot.createdAt.toISOString() }
      return { input, snapshot: view, source: { taskId: source.source.id, code: source.source.code, title: source.source.title,
        assistant: { id: source.assistant.id, name: source.assistant.name, color: source.assistant.color } },
        messages: selectedMessages, messageCount: selectedMessages.length, newMessages: newMessagesSince(view, all),
        detached: !(await this.shared(taskId, row.sourceTaskId)),
        bytes: snapshot.mode === 'summary' ? byteLength(snapshot.summaryText ?? '') : selectedMessages.reduce((n, item) => n + messageBytes(item, 'brief'), 0),
        bytesFull: snapshot.mode === 'summary' ? byteLength(snapshot.summaryText ?? '') : selectedMessages.reduce((n, item) => n + messageBytes(item, 'full'), 0) }
    }))
  }
  async list(taskId: string, actor?: string) { return (await this.load(taskId, actor)).map(({ messages: _messages, ...row }) => row) }

  /** Only the immediately preceding AI request, with present-day existence and access checks. */
  async previousMaterials(actor: string, taskId: string): Promise<PreviousMaterial[]> {
    await assertTaskAccess(this.db, actor, taskId)
    await this.taskRow(taskId)
    const [previous] = await this.db.select({ id: chatRequest.id }).from(chatRequest)
      .innerJoin(thread, eq(thread.id, chatRequest.threadId)).innerJoin(message, eq(message.id, chatRequest.userMessageId))
      .where(eq(thread.taskId, taskId)).orderBy(desc(message.seq), desc(chatRequest.createdAt), desc(chatRequest.id)).limit(1)
    if (!previous) return []
    const rows = await this.db.select().from(chatRequestInput).where(eq(chatRequestInput.requestId, previous.id)).orderBy(chatRequestInput.seq)
    const linked = await linkedTaskSrs(this.db, actor, taskId)
    const result: PreviousMaterial[] = []
    let linkedFiles: Set<string> | undefined
    for (const row of rows) {
      try {
        if (row.kind === 'file' && row.fileId) {
          const [file] = await this.db.select().from(fileObject).where(and(eq(fileObject.id, row.fileId), isNull(fileObject.deletedAt)))
          if (!file) continue
          await assertFileReadable(this.db, actor, file.id)
          if (file.originSrId) {
            linkedFiles ??= new Set((await taskSrAttachments(this.db, taskId)).map(item => item.file.id))
            if (!linkedFiles.has(file.id)) continue
          } else if (file.originTaskId !== taskId && (!file.originTaskId || !(await this.shared(taskId, file.originTaskId)))) continue
          if (file.originTaskId) await this.taskRow(file.originTaskId)
          result.push({ kind: 'file', fileId: file.id, weight: row.weight as Weight })
        } else if (row.kind === 'sr' && row.srId && linked.some(sr => sr.id === row.srId)) {
          result.push({ kind: 'sr', srId: row.srId })
        } else if (row.kind === 'conversation' && row.sourceTaskId && row.snapshotId) {
          await assertTaskAccess(this.db, actor, row.sourceTaskId)
          await this.taskRow(row.sourceTaskId)
          if (!(await this.shared(taskId, row.sourceTaskId))) continue
          result.push({ kind: 'conversation', sourceTaskId: row.sourceTaskId, snapshotId: row.snapshotId, mode: row.mode as Mode, weight: row.weight as Weight })
        }
      } catch (error) {
        if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) throw error
      }
    }
    return result
  }

  async select(actor: string, taskId: string, sourceTaskId: string, options: SelectConversation, allowDetachedFull = false) {
    await assertTaskAccess(this.db, actor, taskId)
    await assertTaskAccess(this.db, actor, sourceTaskId)
    if (taskId === sourceTaskId) throw new BadRequestException({ code: 'SELF_REFERENCE', message: '자기 대화는 참조할 수 없습니다' })
    if (options.weight && !['main', 'reference'].includes(options.weight)) throw new BadRequestException('등급이 올바르지 않습니다')
    const snapshotId = id()
    await this.db.transaction(async (tx) => {
      const locked = await this.lockPair(tx, [taskId, sourceTaskId])
      const current = locked.find((row) => row.id === taskId)!
      if (current.status === 'done') throw new ConflictException({ code: 'TASK_DONE', message: '완료된 대화는 재개한 뒤 수정하세요' })
      const [existing] = await tx.select().from(conversationInput).where(and(eq(conversationInput.taskId, taskId), eq(conversationInput.sourceTaskId, sourceTaskId))).for('update')
      if (!(allowDetachedFull && options.mode === 'full' && existing) && (options.mode !== 'summary' || !existing)
        && !(await this.shared(taskId, sourceTaskId, tx))) throw new ConflictException({ code: 'TAG_NOT_SHARED' })
      if (options.snapshotId) {
        const [recorded] = await tx.select({ snapshot: contextSnapshot }).from(chatRequestInput)
          .innerJoin(chatRequest, eq(chatRequest.id, chatRequestInput.requestId)).innerJoin(thread, eq(thread.id, chatRequest.threadId))
          .innerJoin(contextSnapshot, eq(contextSnapshot.id, chatRequestInput.snapshotId))
          .where(and(eq(thread.taskId, taskId), eq(chatRequestInput.sourceTaskId, sourceTaskId), eq(contextSnapshot.id, options.snapshotId))).limit(1)
        if (!recorded || recorded.snapshot.mode !== options.mode) throw new BadRequestException('이 대화에서 사용한 자료 기록이 아닙니다')
        const values = { snapshotId: options.snapshotId, mode: options.mode, weight: options.weight ?? existing?.weight ?? 'reference', selectedBy: actor, selectedAt: new Date() }
        if (existing) await tx.update(conversationInput).set(values).where(eq(conversationInput.id, existing.id))
        else await tx.insert(conversationInput).values({ id: id(), taskId, sourceTaskId, ...values })
        await tx.insert(activityLog).values({ id: id(), type: 'context.selected', userId: actor, taskId, payload: { snapshotId: options.snapshotId, mode: options.mode } })
        return
      }
      const all = await this.messages(sourceTaskId, tx)
      const supplied = options.mode === 'summary' ? options.summary?.messageIds : options.messageIds
      if (supplied && (new Set(supplied).size !== supplied.length || supplied.some((value) => !all.some((row) => row.id === value)))) throw badIds()
      if (options.mode === 'summary' && (!options.summary?.text.trim() || !options.summary.messageIds)) throw new BadRequestException('요약 내용과 원본 메시지가 필요합니다')
      const chosen = options.mode === 'full' ? all : all.filter((row) => supplied?.includes(row.id))
      if (options.mode !== 'summary' && !chosen.length) throw new BadRequestException('전달할 메시지가 없습니다')
      const boundary = all.at(-1)
      await tx.insert(contextSnapshot).values({ id: snapshotId, sourceTaskId, mode: options.mode, upToMessageId: boundary?.id ?? null,
        summaryText: options.mode === 'summary' ? options.summary!.text.trim() : null,
        summarySource: options.mode === 'summary' ? options.summary!.source : null,
        summaryModel: options.mode === 'summary' ? options.summary!.model ?? null : null, createdBy: actor })
      if (chosen.length) await tx.insert(contextSnapshotMessage).values(chosen.map((row, seq) => ({ snapshotId, messageId: row.id, seq })))
      if (existing) await tx.update(conversationInput).set({ snapshotId, mode: options.mode, weight: options.weight ?? existing.weight, selectedBy: actor, selectedAt: new Date() }).where(eq(conversationInput.id, existing.id))
      else await tx.insert(conversationInput).values({ id: id(), taskId, sourceTaskId, snapshotId, mode: options.mode, weight: options.weight ?? 'reference', selectedBy: actor })
      await tx.insert(activityLog).values({ id: id(), type: existing ? 'context.refreshed' : 'context.selected', userId: actor, taskId, payload: { code: locked.find((row) => row.id === sourceTaskId)?.code, mode: options.mode, messages: chosen.length, weight: options.weight ?? existing?.weight ?? 'reference' } })
    })
    this.events?.publish('context.updated', { taskId })
    return (await this.list(taskId)).find((row) => row.input.sourceTaskId === sourceTaskId)!
  }

  async refresh(actor: string, taskId: string, sourceTaskId: string) {
    await assertTaskAccess(this.db, actor, taskId)
    await assertTaskAccess(this.db, actor, sourceTaskId)
    const [row] = await this.db.select().from(conversationInput).where(and(eq(conversationInput.taskId, taskId), eq(conversationInput.sourceTaskId, sourceTaskId)))
    if (!row) throw new NotFoundException('선택을 찾을 수 없습니다')
    if (row.mode !== 'full') throw new BadRequestException('전체 원문만 바로 갱신할 수 있습니다')
    return this.select(actor, taskId, sourceTaskId, { mode: 'full', weight: row.weight as Weight }, true)
  }
  async setWeight(actor: string, taskId: string, sourceTaskId: string, weight: Weight) {
    await assertTaskAccess(this.db, actor, taskId)
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(task).where(and(eq(task.id, taskId), isNull(task.deletedAt))).for('update')
      if (!current) throw new NotFoundException('대화를 찾을 수 없습니다')
      if (current.status === 'done') throw new ConflictException({ code: 'TASK_DONE', message: '완료된 대화는 재개한 뒤 수정하세요' })
      const result = await tx.update(conversationInput).set({ weight }).where(and(eq(conversationInput.taskId, taskId), eq(conversationInput.sourceTaskId, sourceTaskId)))
      if (!result[0].affectedRows) throw new NotFoundException('선택을 찾을 수 없습니다')
      await tx.insert(activityLog).values({ id: id(), type: 'context.selected', userId: actor, taskId, payload: { sourceTaskId, weight } })
    })
    this.events?.publish('context.updated', { taskId })
  }
  async remove(actor: string, taskId: string, sourceTaskId: string) {
    await assertTaskAccess(this.db, actor, taskId)
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(task).where(and(eq(task.id, taskId), isNull(task.deletedAt))).for('update')
      if (!current) throw new NotFoundException('대화를 찾을 수 없습니다')
      if (current.status === 'done') throw new ConflictException({ code: 'TASK_DONE', message: '완료된 대화는 재개한 뒤 수정하세요' })
      const result = await tx.delete(conversationInput).where(and(eq(conversationInput.taskId, taskId), eq(conversationInput.sourceTaskId, sourceTaskId)))
      if (result[0].affectedRows) await tx.insert(activityLog).values({ id: id(), type: 'context.removed', userId: actor, taskId, payload: { sourceTaskId } })
    })
    this.events?.publish('context.updated', { taskId })
  }
  async preview(sourceTaskId: string, actor?: string) { if (actor) await assertTaskAccess(this.db, actor, sourceTaskId); await this.taskRow(sourceTaskId); return this.messages(sourceTaskId) }
}
