import { randomUUID } from 'node:crypto'
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { applyTaskStatus, eligibleMessages, isSrTag, normalizeTag, tagKey, tagSuggestions, type Message, type Task, type TaskStatus, type Thread } from '@mes/domain'
import { and, desc, eq, exists, inArray, isNull, or, sql } from 'drizzle-orm'
import { unionAll } from 'drizzle-orm/mysql-core'
import { DB, type Db } from '../db/db.module.js'
import { activityLog, appUser, assistant, chatRequest, chatRequestInput, contextSnapshot, contextSnapshotMessage, conversationInput, dbLock, fileObject, message, messageAttachment, tag, task, taskAssignee, taskInput, taskTag, thread } from '../db/schema.js'
import { EventsService } from '../events/events.service.js'

export interface CreateTaskInput {
  assistantId: string
  tags?: string[]
  title?: string
  referenceTaskId?: string
  inputFileIds?: string[]
  firstMessage?: string
}
export interface TaskPatch {
  title?: string
  summary?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  dueDate?: string | null
  assigneeIds?: string[]
  ownerId?: string
  modelId?: string | null
}
export interface TaskFilter { assistantId?: string; status?: string[]; tags?: string[]; mine?: string }

const id = () => randomUUID()
const iso = (value: Date | null | undefined) => value?.toISOString()
const uniqueTags = (values: string[]) => [...new Map(values.map((value) => normalizeTag(value)).filter(Boolean).map((value) => [tagKey(value), value])).values()]
const checkTagLength = (label: string) => { if ([...tagKey(label)].length > 191) throw new BadRequestException('태그가 너무 깁니다') }

@Injectable()
export class DbTasksService {
  constructor(@Inject(DB) private readonly db: Db, @Inject(EventsService) private readonly events?: EventsService) {}

  private async row(taskId: string) {
    const [row] = await this.db.select().from(task).where(and(eq(task.id, taskId), isNull(task.deletedAt)))
    if (!row) throw new NotFoundException('대화를 찾을 수 없습니다')
    return row
  }

  private async lockedRow(tx: Parameters<Parameters<Db['transaction']>[0]>[0], taskId: string) {
    const [row] = await tx.select().from(task).where(and(eq(task.id, taskId), isNull(task.deletedAt))).for('update')
    if (!row) throw new NotFoundException('대화를 찾을 수 없습니다')
    return row
  }

  private async ensureEditable(tx: Parameters<Parameters<Db['transaction']>[0]>[0], taskId: string) {
    const row = await this.lockedRow(tx, taskId)
    if (row.status === 'done') throw new ConflictException('완료된 대화는 재개한 뒤 수정하세요')
    return row
  }

  private async assemble(rows: (typeof task.$inferSelect)[]): Promise<(Task & { thread?: Thread })[]> {
    if (!rows.length) return []
    const ids = rows.map((row) => row.id)
    const [tags, assigneesAndThreads, materials] = await Promise.all([
      this.db.select({ taskId: taskTag.taskId, label: tag.label }).from(taskTag).innerJoin(tag, eq(taskTag.tagKey, tag.key)).where(inArray(taskTag.taskId, ids)).orderBy(taskTag.addedAt),
      this.db.select({ taskId: thread.taskId, userId: taskAssignee.userId, taskThread: thread }).from(thread).leftJoin(taskAssignee, eq(taskAssignee.taskId, thread.taskId)).where(inArray(thread.taskId, ids)),
      unionAll(
        this.db.select({ taskId: taskInput.taskId, fileId: taskInput.fileId, weight: taskInput.weight, sortOrder: taskInput.sortOrder, selectedBy: taskInput.selectedBy, selectedAt: taskInput.selectedAt, isOutput: sql<boolean>`false` }).from(taskInput).where(inArray(taskInput.taskId, ids)),
        this.db.select({ taskId: sql<string>`coalesce(${fileObject.originTaskId}, '')`, fileId: fileObject.id, weight: sql<string>`null`, sortOrder: sql<number>`null`, selectedBy: sql<string>`null`, selectedAt: sql<Date>`null`, isOutput: sql<boolean>`true` }).from(fileObject).where(and(inArray(fileObject.originTaskId, ids), eq(fileObject.isOutput, true), sql`${fileObject.deletedAt} is null`)),
      ),
    ])
    return rows.map((row) => {
      const taskId = row.id
      const taskThread = assigneesAndThreads.find((item) => item.taskId === taskId)?.taskThread
      return {
        id: row.id, code: row.code, assistantId: row.assistantId, title: row.title,
        titleSource: row.titleSource as Task['titleSource'], summary: row.summary,
        status: row.status as TaskStatus, ownerId: row.ownerId,
        assigneeIds: assigneesAndThreads.filter((item) => item.taskId === taskId && item.userId !== null).map((item) => item.userId!), priority: row.priority as Task['priority'],
        ...(row.dueDate && { dueDate: row.dueDate }), tags: tags.filter((item) => item.taskId === taskId).map((item) => item.label),
        checklist: [], inputs: materials.filter((item) => item.taskId === taskId && !item.isOutput).sort((a, b) => (a.weight === b.weight ? a.sortOrder! - b.sortOrder! : a.weight === 'main' ? -1 : 1)).map((item) => ({ fileId: item.fileId, weight: item.weight as 'main' | 'reference', selectedBy: item.selectedBy!, selectedAt: item.selectedAt!.toISOString() })),
        outputFileIds: materials.filter((item) => item.taskId === taskId && item.isOutput).map((item) => item.fileId), ...(taskThread && { threadId: taskThread.id,
          thread: { id: taskThread.id, taskId, title: taskThread.title, createdAt: taskThread.createdAt.toISOString(), createdBy: taskThread.createdBy, archived: false, ...(taskThread.modelId && { modelId: taskThread.modelId }) } }),
        ...(row.modelId && { modelId: row.modelId }), createdAt: row.createdAt.toISOString(),
        createdBy: row.createdBy, lastActivityAt: row.lastActivityAt.toISOString(),
        ...(iso(row.startedAt) && { startedAt: iso(row.startedAt)! }),
        ...(iso(row.completedAt) && { completedAt: iso(row.completedAt)! }),
        ...(row.completedBy && { completedBy: row.completedBy }),
      }
    })
  }

  async get(taskId: string): Promise<Task & { thread?: Thread }> {
    return (await this.assemble([await this.row(taskId)]))[0]!
  }

  async create(actor: string, input: CreateTaskInput, idempotencyKey?: string) {
    if (idempotencyKey && [...idempotencyKey].length > 191) throw new BadRequestException('Idempotency-Key가 너무 깁니다')
    if (input.referenceTaskId && [...input.referenceTaskId].length > 191) throw new BadRequestException('참조 대화 ID가 너무 깁니다')
    if (idempotencyKey) {
      const [existing] = await this.db.select({ id: task.id }).from(task).where(eq(task.idempotencyKey, idempotencyKey))
      if (existing) { const found = await this.get(existing.id); return { task: found, thread: found.thread! } }
    }
    const [selected] = await this.db.select().from(assistant).where(eq(assistant.id, input.assistantId))
    if (!selected) throw new NotFoundException('에이전트를 찾을 수 없습니다')
    if (selected.status === 'retired') throw new ConflictException('폐기된 에이전트로는 시작할 수 없습니다')
    const tags = uniqueTags(input.tags ?? [])
    tags.forEach(checkTagLength)
    const taskId = id()
    const threadId = id()
    const now = new Date()
    const warnings: string[] = []
    const createdId = await this.db.transaction(async (tx) => {
      const year = now.getFullYear()
      const lockKey = `task-code:${year}`
      await tx.insert(dbLock).values({ lockKey }).onDuplicateKeyUpdate({ set: { lockKey } })
      await tx.select().from(dbLock).where(eq(dbLock.lockKey, lockKey)).for('update')
      if (idempotencyKey) {
        const [duplicate] = await tx.select({ id: task.id }).from(task).where(eq(task.idempotencyKey, idempotencyKey))
        if (duplicate) return duplicate.id
      }
      const [max] = await tx.select({ value: sql<number>`coalesce(max(cast(substring(${task.code}, 9) as unsigned)), 0)` }).from(task).where(sql`${task.code} like ${`WK-${year}-%`}`)
      const code = `WK-${year}-${String(Number(max?.value ?? 0) + 1).padStart(4, '0')}`
      await tx.insert(task).values({ id: taskId, code, assistantId: selected.id,
        title: input.title?.trim() || `${selected.name} 대화 ${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        titleSource: input.title?.trim() ? 'manual' : 'default', status: 'in_progress',
        ownerId: actor, priority: 'normal', createdBy: actor, startedAt: now, lastActivityAt: now, idempotencyKey })
      await tx.insert(taskAssignee).values({ taskId, userId: actor })
      await tx.insert(thread).values({ id: threadId, taskId, title: '대화', createdBy: actor })
      if (input.firstMessage?.trim()) {
        await tx.insert(message).values({ id: id(), threadId, seq: 1, role: 'user', kind: 'discussion', content: input.firstMessage.trim(), authorId: actor, status: 'done' })
        await tx.insert(activityLog).values({ id: id(), type: 'message.sent', userId: actor, taskId, payload: { kind: 'discussion' } })
      }
      for (const label of tags) {
        const key = tagKey(label)
        await tx.insert(tag).values({ key, label, kind: isSrTag(label) ? 'sr' : 'keyword' }).onDuplicateKeyUpdate({ set: { key } })
        await tx.insert(taskTag).values({ taskId, tagKey: key, addedBy: actor })
        await tx.insert(activityLog).values({ id: id(), type: 'tag.added', userId: actor, taskId, payload: { tag: label } })
      }
      if (input.referenceTaskId) {
        const [source] = await tx.select().from(task).where(and(eq(task.id, input.referenceTaskId), isNull(task.deletedAt))).for('update')
        const sourceTags = source ? await tx.select({ key: taskTag.tagKey }).from(taskTag).where(eq(taskTag.taskId, source.id)) : []
        if (!source || !sourceTags.some((item) => tags.some((label) => tagKey(label) === item.key))) {
          warnings.push('참조 대화와 직접 공유하는 태그가 없어 선택하지 않았습니다.')
        } else {
          const [sourceThread] = await tx.select({ id: thread.id }).from(thread).where(eq(thread.taskId, source.id))
          const rows = sourceThread ? await tx.select().from(message).where(eq(message.threadId, sourceThread.id)).orderBy(message.seq) : []
          const chosen = eligibleMessages(rows.map((row) => ({ id: row.id, threadId: row.threadId, seq: row.seq, role: row.role as Message['role'],
            kind: row.kind as Message['kind'], content: row.content, status: row.status as Message['status'], authorId: row.authorId ?? undefined,
            createdAt: row.createdAt.toISOString(), attachmentIds: [] })))
          if (!chosen.length) warnings.push('참조 대화에 전달할 메시지가 없어 선택하지 않았습니다.')
          else {
            const snapshotId = id()
            await tx.insert(contextSnapshot).values({ id: snapshotId, sourceTaskId: source.id, mode: 'full', upToMessageId: chosen.at(-1)!.id, createdBy: actor })
            await tx.insert(contextSnapshotMessage).values(chosen.map((row, seq) => ({ snapshotId, messageId: row.id, seq })))
            await tx.insert(conversationInput).values({ id: id(), taskId, sourceTaskId: source.id, weight: 'main', mode: 'full', snapshotId, selectedBy: actor })
            await tx.insert(activityLog).values({ id: id(), type: 'context.selected', userId: actor, taskId, payload: { code: source.code, mode: 'full', messages: chosen.length, weight: 'main' } })
          }
        }
      }
      await tx.insert(activityLog).values({ id: id(), type: 'task.created', userId: actor, taskId, assistantId: selected.id, payload: { assistantName: selected.name } })
      return taskId
    })
    const created = await this.get(createdId)
    if (createdId === taskId) {
      this.events?.publish('task.created', { taskId, assistantId: selected.id })
      if (input.firstMessage?.trim()) {
        const [first] = await this.db.select({ id: message.id }).from(message).where(eq(message.threadId, threadId)).orderBy(message.seq).limit(1)
        if (first) this.events?.publish('message.appended', { threadId, taskId, messageId: first.id })
      }
      if (input.referenceTaskId && !warnings.length) this.events?.publish('context.updated', { taskId })
    }
    return { task: created, thread: created.thread!, warnings }
  }

  async list(filter: TaskFilter = {}): Promise<Task[]> {
    const conditions = [
      isNull(task.deletedAt),
      ...(filter.assistantId ? [eq(task.assistantId, filter.assistantId)] : []),
      ...(filter.status?.length ? [inArray(task.status, filter.status)] : []),
      ...(filter.mine ? [or(
        eq(task.ownerId, filter.mine),
        exists(this.db.select({ id: taskAssignee.taskId }).from(taskAssignee).where(and(eq(taskAssignee.taskId, task.id), eq(taskAssignee.userId, filter.mine)))),
      )] : []),
      ...[...new Set((filter.tags ?? []).map(tagKey))].map((key) => exists(this.db.select({ id: taskTag.taskId }).from(taskTag).where(and(eq(taskTag.taskId, task.id), eq(taskTag.tagKey, key))))),
    ]
    const rows = await this.db.select().from(task).where(and(...conditions)).orderBy(desc(task.lastActivityAt))
    return this.assemble(rows)
  }

  async update(actor: string, taskId: string, patch: TaskPatch): Promise<Task> {
    if (patch.title !== undefined && !patch.title.trim()) throw new BadRequestException('제목이 필요합니다')
    const userIds = [...new Set([patch.ownerId, ...(patch.assigneeIds ?? [])].filter((value): value is string => !!value))]
    if (userIds.length) {
      const found = await this.db.select({ id: appUser.id }).from(appUser).where(inArray(appUser.id, userIds))
      if (found.length !== userIds.length) throw new BadRequestException('존재하지 않는 담당자가 있습니다')
    }
    await this.db.transaction(async (tx) => {
      await this.ensureEditable(tx, taskId)
      await tx.update(task).set({
        ...(patch.title !== undefined && { title: patch.title.trim(), titleSource: 'manual' }),
        ...(patch.summary !== undefined && { summary: patch.summary }),
        ...(patch.priority !== undefined && { priority: patch.priority }),
        ...(patch.dueDate !== undefined && { dueDate: patch.dueDate }),
        ...(patch.ownerId !== undefined && { ownerId: patch.ownerId }),
        ...(patch.modelId !== undefined && { modelId: patch.modelId }),
        lastActivityAt: new Date(),
      }).where(eq(task.id, taskId))
      if (patch.assigneeIds) {
        await tx.delete(taskAssignee).where(eq(taskAssignee.taskId, taskId))
        const users = [...new Set(patch.assigneeIds)]
        if (users.length) await tx.insert(taskAssignee).values(users.map((userId) => ({ taskId, userId })))
      }
      if (patch.modelId !== undefined) await tx.insert(activityLog).values({ id: id(), type: 'model.changed', userId: actor, taskId, payload: { modelId: patch.modelId } })
    })
    this.events?.publish('task.updated', { taskId })
    return this.get(taskId)
  }

  async setStatus(actor: string, taskId: string, status: TaskStatus, reason?: string): Promise<Task> {
    await this.db.transaction(async (tx) => {
      const current = await this.lockedRow(tx, taskId)
      if (status === 'done') {
        const [active] = await tx.select({ id: chatRequest.id }).from(chatRequest).innerJoin(thread, eq(chatRequest.threadId, thread.id))
          .where(and(eq(thread.taskId, taskId), inArray(chatRequest.status, ['pending', 'streaming']))).limit(1)
        if (active) throw new ConflictException({ code: 'REQUEST_ACTIVE' })
      }
      if (current.status === status) return
      if (current.status === 'done' && !reason?.trim()) throw new BadRequestException('재개 사유가 필요합니다')
      const next = applyTaskStatus((await this.assemble([current]))[0]!, status, actor, new Date().toISOString())
      const type = current.status === 'done' ? 'task.reopened' : ({ done: 'task.completed', in_progress: 'task.started', on_hold: 'task.hold', todo: 'task.status_changed' } as const)[status]
      await tx.update(task).set({ status, startedAt: next.startedAt ? new Date(next.startedAt) : null,
        completedAt: next.completedAt ? new Date(next.completedAt) : null, completedBy: next.completedBy ?? null,
        lastActivityAt: new Date() }).where(eq(task.id, taskId))
      await tx.insert(activityLog).values({ id: id(), type, userId: actor, taskId, assistantId: current.assistantId, payload: { from: current.status, to: status, ...(reason && { reason }) } })
    })
    this.events?.publish('task.updated', { taskId })
    return this.get(taskId)
  }

  async addTag(actor: string, taskId: string, raw: string): Promise<void> {
    const label = normalizeTag(raw)
    if (!label) throw new BadRequestException('태그가 필요합니다')
    checkTagLength(label)
    const key = tagKey(label)
    await this.db.transaction(async (tx) => {
      await this.ensureEditable(tx, taskId)
      await tx.insert(tag).values({ key, label, kind: isSrTag(label) ? 'sr' : 'keyword' }).onDuplicateKeyUpdate({ set: { key } })
      const [existing] = await tx.select({ taskId: taskTag.taskId }).from(taskTag).where(and(eq(taskTag.taskId, taskId), eq(taskTag.tagKey, key)))
      if (!existing) {
        await tx.insert(taskTag).values({ taskId, tagKey: key, addedBy: actor })
        await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, taskId))
        await tx.insert(activityLog).values({ id: id(), type: 'tag.added', userId: actor, taskId, payload: { tag: label } })
      }
    })
    this.events?.publish('task.updated', { taskId })
  }

  async removeTag(actor: string, taskId: string, raw: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.ensureEditable(tx, taskId)
      const removed = await tx.delete(taskTag).where(and(eq(taskTag.taskId, taskId), eq(taskTag.tagKey, tagKey(raw))))
      if (removed[0].affectedRows) {
        await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, taskId))
        await tx.insert(activityLog).values({ id: id(), type: 'tag.removed', userId: actor, taskId, payload: { tag: normalizeTag(raw) } })
      }
    })
    this.events?.publish('task.updated', { taskId })
  }

  async suggestions(prefix: string, exclude: string[] = []) {
    return tagSuggestions(await this.list(), [], prefix, exclude)
  }

  async messages(threadId: string) {
    const [target] = await this.db.select().from(thread).where(eq(thread.id, threadId))
    if (!target?.taskId) throw new NotFoundException('스레드를 찾을 수 없습니다')
    await this.row(target.taskId)
    const rows = await this.db.select().from(message).where(eq(message.threadId, threadId)).orderBy(message.seq)
    const attachments = rows.length ? await this.db.select().from(messageAttachment).where(inArray(messageAttachment.messageId, rows.map((row) => row.id))) : []
    const requests = await this.db.select({ id: chatRequest.id, replyMessageId: chatRequest.replyMessageId }).from(chatRequest).where(eq(chatRequest.threadId, threadId))
    return rows.map((row) => ({
      id: row.id, threadId: row.threadId, seq: row.seq, role: row.role, kind: row.kind,
      content: row.content, authorId: row.authorId, status: row.status, error: row.error, createdAt: row.createdAt.toISOString(), attachmentIds: attachments.filter((item) => item.messageId === row.id).map((item) => item.fileId),
      ...(requests.find((item) => item.replyMessageId === row.id) ? { requestId: requests.find((item) => item.replyMessageId === row.id)!.id } : {}),
    }))
  }

  async appendMessage(actor: string, threadId: string, input: { content: string; kind: 'discussion'; attachmentIds?: string[] }) {
    if (input.kind !== 'discussion') throw new BadRequestException('AI 요청은 S3에서 지원합니다')
    if (!input.content?.trim() && !input.attachmentIds?.length) throw new BadRequestException('내용이 필요합니다')
    const messageId = id()
    const taskId = await this.db.transaction(async (tx) => {
      const [target] = await tx.select().from(thread).where(eq(thread.id, threadId))
      if (!target?.taskId) throw new NotFoundException('스레드를 찾을 수 없습니다')
      await this.ensureEditable(tx, target.taskId)
      const attachmentIds = [...new Set(input.attachmentIds ?? [])]
      if (attachmentIds.length) {
        const valid = await tx.select({ id: fileObject.id }).from(fileObject).where(and(inArray(fileObject.id, attachmentIds), eq(fileObject.originTaskId, target.taskId), sql`${fileObject.deletedAt} is null`))
        if (valid.length !== attachmentIds.length) throw new BadRequestException('첨부 파일이 이 대화에 없습니다')
      }
      await tx.select({ id: thread.id }).from(thread).where(eq(thread.id, threadId)).for('update')
      const [max] = await tx.select({ value: sql<number>`coalesce(max(${message.seq}), 0)` }).from(message).where(eq(message.threadId, threadId))
      await tx.insert(message).values({ id: messageId, threadId, seq: Number(max?.value ?? 0) + 1, role: 'user', kind: 'discussion', content: input.content.trim(), authorId: actor, status: 'done' })
      if (attachmentIds.length) await tx.insert(messageAttachment).values(attachmentIds.map((fileId) => ({ messageId, fileId })))
      await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, target.taskId!))
      await tx.insert(activityLog).values({ id: id(), type: 'message.sent', userId: actor, taskId: target.taskId, payload: { kind: 'discussion' } })
      return target.taskId
    })
    this.events?.publish('message.appended', { threadId, taskId, messageId })
    return (await this.messages(threadId)).find((item) => item.id === messageId)
  }

  async activity(taskId: string) {
    await this.row(taskId)
    return (await this.db.select().from(activityLog).where(eq(activityLog.taskId, taskId)).orderBy(desc(activityLog.at))).map((row) => ({
      id: row.id, taskId: row.taskId, assistantId: row.assistantId, userId: row.userId, type: row.type,
      payload: row.payload, at: row.at.toISOString(),
    }))
  }

  async delete(taskId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [owner] = await tx.select({ id: task.id }).from(task).where(and(eq(task.id, taskId), isNull(task.deletedAt))).for('update')
      if (!owner) throw new NotFoundException('대화를 찾을 수 없습니다')
      const [selectedAsContext] = await tx.select({ id: conversationInput.id }).from(conversationInput).where(eq(conversationInput.sourceTaskId, taskId)).limit(1)
      if (selectedAsContext) throw new ConflictException({ code: 'REFERENCED', message: '다른 대화가 이 대화를 참조 입력으로 사용합니다' })
      const [usedSnapshot] = await tx.select({ id: chatRequestInput.requestId }).from(chatRequestInput)
        .innerJoin(contextSnapshot, eq(chatRequestInput.snapshotId, contextSnapshot.id)).where(eq(contextSnapshot.sourceTaskId, taskId)).limit(1)
      if (usedSnapshot) throw new ConflictException({ code: 'REFERENCED', message: '요청 기록이 이 대화를 참조합니다' })
      const ownFiles = await tx.select({ id: fileObject.id }).from(fileObject).where(eq(fileObject.originTaskId, taskId))
      if (ownFiles.length) {
        const used = await tx.select().from(taskInput).where(inArray(taskInput.fileId, ownFiles.map((file) => file.id)))
        if (used.some((item) => item.taskId !== taskId)) throw new ConflictException('다른 대화가 이 대화의 파일을 입력으로 사용합니다')
      }
      const [activeRequest] = await tx.select({ id: chatRequest.id }).from(chatRequest).innerJoin(thread, eq(chatRequest.threadId, thread.id))
        .where(and(eq(thread.taskId, taskId), inArray(chatRequest.status, ['pending', 'streaming']))).limit(1)
      if (activeRequest) throw new ConflictException({ code: 'REQUEST_ACTIVE' })
      await tx.delete(conversationInput).where(eq(conversationInput.taskId, taskId))
      await tx.update(task).set({ deletedAt: new Date() }).where(eq(task.id, taskId))
    })
    this.events?.publish('task.updated', { taskId })
  }
}
