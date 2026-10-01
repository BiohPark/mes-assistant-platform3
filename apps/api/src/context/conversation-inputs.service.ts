import { randomUUID } from 'node:crypto'
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { byteLength, eligibleMessages, newMessagesSince, type ContextSnapshot, type ConversationInput, type Message } from '@mes/domain'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module.js'
import { EventsService } from '../events/events.service.js'
import { activityLog, assistant, contextSnapshot, contextSnapshotMessage, conversationInput, message, tag, task, taskTag, thread } from '../db/schema.js'
import { assertTaskAccess } from '../sr/access.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Weight = 'main' | 'reference'
type Mode = 'full' | 'messages' | 'summary'
export interface SelectConversation { mode: Mode; weight?: Weight; messageIds?: string[]; summary?: { text: string; source: 'ai' | 'rule'; model?: string; messageIds: string[] } }
const id = () => randomUUID()
const badIds = () => new BadRequestException({ code: 'INVALID_MESSAGE_IDS' })
const eligible = (rows: (typeof message.$inferSelect)[]): Message[] => eligibleMessages(rows.map((row) => ({
  id: row.id, threadId: row.threadId, seq: row.seq, role: row.role as Message['role'], kind: row.kind as Message['kind'], content: row.content,
  status: row.status as Message['status'], authorId: row.authorId ?? undefined, createdAt: row.createdAt.toISOString(), attachmentIds: [],
})))

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
    const visibleSources = actor ? (await Promise.all(sources.map(async (item) => {
      try { await assertTaskAccess(this.db, actor, item.source.id); return item }
      catch (error) { if (error instanceof ForbiddenException) return null; throw error }
    }))).filter((item): item is (typeof sources)[number] => item !== null) : sources
    const counts = visibleSources.length ? await this.db.select({ taskId: thread.taskId, count: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(octet_length(${message.content})), 0)` })
      .from(thread).innerJoin(message, eq(message.threadId, thread.id))
      .where(and(inArray(thread.taskId, visibleSources.map((item) => item.source.id)), inArray(message.role, ['user', 'assistant']),
        eq(message.status, 'done'), isNull(message.kind), sql`trim(${message.content}) <> ''`)).groupBy(thread.taskId) : []
    const countsByTask = new Map(counts.map((row) => [row.taskId, row]))
    const selected = await this.db.select().from(conversationInput).where(eq(conversationInput.taskId, taskId))
    const loaded = await this.list(taskId)
    return visibleSources.map(({ source, assistant: agent }) => {
      const count = countsByTask.get(source.id)
      const choice = selected.find((row) => row.sourceTaskId === source.id)
      const detail = choice && loaded.find((row) => row.input.sourceTaskId === source.id)
      return { taskId: source.id, code: source.code, title: source.title, status: source.status,
        assistant: { id: agent.id, name: agent.name, color: agent.color }, sharedTags: tags.get(source.id)!,
        messageCount: Number(count?.count ?? 0), bytes: Number(count?.bytes ?? 0), lastActivityAt: source.lastActivityAt.toISOString(),
        ...(detail && { selected: { weight: detail.input.weight, mode: detail.input.mode, snapshotId: detail.snapshot.id, newMessages: detail.newMessages, detached: detail.detached } }) }
    })
  }

  async load(taskId: string, actor?: string) {
    if (actor) await assertTaskAccess(this.db, actor, taskId)
    await this.taskRow(taskId)
    const rows = await this.db.select().from(conversationInput).where(eq(conversationInput.taskId, taskId)).orderBy(conversationInput.selectedAt, conversationInput.id)
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
        mode: row.mode as Mode, snapshotId: row.snapshotId, selectedBy: row.selectedBy, selectedAt: row.selectedAt.toISOString() }
      const view: ContextSnapshot = { id: snapshot.id, sourceTaskId: snapshot.sourceTaskId, mode: snapshot.mode as Mode,
        messageIds: pinned.map((item) => item.messageId), ...(snapshot.upToMessageId && { upToMessageId: snapshot.upToMessageId }),
        ...(boundary && { upToCreatedAt: boundary.createdAt }), ...(snapshot.summaryText !== null && { summaryText: snapshot.summaryText }),
        ...(snapshot.summarySource && { summarySource: snapshot.summarySource as 'ai' | 'rule' }), ...(snapshot.summaryModel && { summaryModel: snapshot.summaryModel }),
        createdBy: snapshot.createdBy, createdAt: snapshot.createdAt.toISOString() }
      return { input, snapshot: view, source: { taskId: source.source.id, code: source.source.code, title: source.source.title,
        assistant: { id: source.assistant.id, name: source.assistant.name, color: source.assistant.color } },
        messages: selectedMessages, messageCount: selectedMessages.length, newMessages: newMessagesSince(view, all),
        detached: !(await this.shared(taskId, row.sourceTaskId)),
        bytes: snapshot.mode === 'summary' ? byteLength(snapshot.summaryText ?? '') : selectedMessages.reduce((n, item) => n + byteLength(item.content), 0) }
    }))
  }
  async list(taskId: string, actor?: string) { return (await this.load(taskId, actor)).map(({ messages: _messages, ...row }) => row) }

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
