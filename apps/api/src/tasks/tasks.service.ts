import { randomUUID } from 'node:crypto'
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { applyTaskStatus, isSrTag, normalizeTag, tagKey, tagSuggestions, type Task, type TaskStatus, type Thread } from '@mes/domain'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module.js'
import { activityLog, appUser, assistant, fileObject, message, tag, task, taskAssignee, taskInput, taskTag, thread } from '../db/schema.js'

export interface CreateTaskInput {
  assistantId: string
  tags?: string[]
  title?: string
  referenceTaskId?: string
  inputFileIds?: string[]
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

@Injectable()
export class DbTasksService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async row(taskId: string) {
    const [row] = await this.db.select().from(task).where(eq(task.id, taskId))
    if (!row) throw new NotFoundException('대화를 찾을 수 없습니다')
    return row
  }

  private async ensureEditable(taskId: string) {
    const row = await this.row(taskId)
    if (row.status === 'done') throw new ConflictException('완료된 대화는 재개한 뒤 수정하세요')
    return row
  }

  async get(taskId: string): Promise<Task & { thread?: Thread }> {
    const row = await this.row(taskId)
    const [tags, assignees, threads] = await Promise.all([
      this.db.select({ label: tag.label }).from(taskTag).innerJoin(tag, eq(taskTag.tagKey, tag.key)).where(eq(taskTag.taskId, taskId)).orderBy(taskTag.addedAt),
      this.db.select({ userId: taskAssignee.userId }).from(taskAssignee).where(eq(taskAssignee.taskId, taskId)),
      this.db.select().from(thread).where(eq(thread.taskId, taskId)),
    ])
    return {
      id: row.id, code: row.code, assistantId: row.assistantId, title: row.title,
      titleSource: row.titleSource as Task['titleSource'], summary: row.summary,
      status: row.status as TaskStatus, ownerId: row.ownerId,
      assigneeIds: assignees.map((item) => item.userId), priority: row.priority as Task['priority'],
      ...(row.dueDate && { dueDate: row.dueDate }), tags: tags.map((item) => item.label),
      checklist: [], inputs: [], outputFileIds: [], ...(threads[0] && { threadId: threads[0].id,
        thread: { id: threads[0].id, taskId, title: threads[0].title, createdAt: threads[0].createdAt.toISOString(), createdBy: threads[0].createdBy, archived: false, ...(threads[0].modelId && { modelId: threads[0].modelId }) } }),
      ...(row.modelId && { modelId: row.modelId }), createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy, lastActivityAt: row.lastActivityAt.toISOString(),
      ...(iso(row.startedAt) && { startedAt: iso(row.startedAt)! }),
      ...(iso(row.completedAt) && { completedAt: iso(row.completedAt)! }),
      ...(row.completedBy && { completedBy: row.completedBy }),
    }
  }

  async create(actor: string, input: CreateTaskInput) {
    const [selected] = await this.db.select().from(assistant).where(eq(assistant.id, input.assistantId))
    if (!selected) throw new NotFoundException('에이전트를 찾을 수 없습니다')
    if (selected.status === 'retired') throw new ConflictException('폐기된 에이전트로는 시작할 수 없습니다')
    const tags = uniqueTags(input.tags ?? [])
    const taskId = id()
    const threadId = id()
    const now = new Date()
    await this.db.transaction(async (tx) => {
      const year = now.getFullYear()
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('task-code'), ${year})`)
      const [max] = await tx.select({ value: sql<number>`coalesce(max(substring(${task.code} from 9)::int), 0)` }).from(task).where(sql`${task.code} like ${`WK-${year}-%`}`)
      const code = `WK-${year}-${String(Number(max?.value ?? 0) + 1).padStart(4, '0')}`
      await tx.insert(task).values({ id: taskId, code, assistantId: selected.id,
        title: input.title?.trim() || `${selected.name} 대화 ${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        titleSource: input.title?.trim() ? 'manual' : 'default', status: 'in_progress',
        ownerId: actor, priority: 'normal', createdBy: actor, startedAt: now, lastActivityAt: now })
      await tx.insert(taskAssignee).values({ taskId, userId: actor })
      await tx.insert(thread).values({ id: threadId, taskId, title: '대화', createdBy: actor })
      for (const label of tags) {
        const key = tagKey(label)
        await tx.insert(tag).values({ key, label, kind: isSrTag(label) ? 'sr' : 'keyword' }).onConflictDoNothing()
        await tx.insert(taskTag).values({ taskId, tagKey: key, addedBy: actor })
        await tx.insert(activityLog).values({ id: id(), type: 'tag.added', userId: actor, taskId, payload: { tag: label } })
      }
      await tx.insert(activityLog).values({ id: id(), type: 'task.created', userId: actor, taskId, assistantId: selected.id, payload: { assistantName: selected.name } })
    })
    return { task: await this.get(taskId), thread: { id: threadId, taskId, title: '대화', createdAt: now.toISOString(), createdBy: actor, archived: false } }
  }

  async list(filter: TaskFilter = {}): Promise<Task[]> {
    const rows = await this.db.select({ id: task.id, ownerId: task.ownerId }).from(task).orderBy(desc(task.lastActivityAt))
    const tasks = await Promise.all(rows.map((row) => this.get(row.id)))
    const wanted = new Set((filter.tags ?? []).map(tagKey))
    return tasks.filter((item) =>
      (!filter.assistantId || item.assistantId === filter.assistantId) &&
      (!filter.status?.length || filter.status.includes(item.status)) &&
      (!filter.mine || item.ownerId === filter.mine || item.assigneeIds.includes(filter.mine)) &&
      ([...wanted].every((key) => item.tags.some((value) => tagKey(value) === key))))
  }

  async update(actor: string, taskId: string, patch: TaskPatch): Promise<Task> {
    await this.ensureEditable(taskId)
    if (patch.title !== undefined && !patch.title.trim()) throw new BadRequestException('제목이 필요합니다')
    const userIds = [...new Set([patch.ownerId, ...(patch.assigneeIds ?? [])].filter((value): value is string => !!value))]
    if (userIds.length) {
      const found = await this.db.select({ id: appUser.id }).from(appUser).where(inArray(appUser.id, userIds))
      if (found.length !== userIds.length) throw new BadRequestException('존재하지 않는 담당자가 있습니다')
    }
    await this.db.transaction(async (tx) => {
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
    return this.get(taskId)
  }

  async setStatus(actor: string, taskId: string, status: TaskStatus, reason?: string): Promise<Task> {
    const current = await this.row(taskId)
    if (current.status === status) return this.get(taskId)
    if (current.status === 'done' && !reason?.trim()) throw new BadRequestException('재개 사유가 필요합니다')
    const next = applyTaskStatus(await this.get(taskId), status, actor, new Date().toISOString())
    const type = current.status === 'done' ? 'task.reopened' : ({ done: 'task.completed', in_progress: 'task.started', on_hold: 'task.hold', todo: 'task.status_changed' } as const)[status]
    await this.db.transaction(async (tx) => {
      await tx.update(task).set({ status, startedAt: next.startedAt ? new Date(next.startedAt) : null,
        completedAt: next.completedAt ? new Date(next.completedAt) : null, completedBy: next.completedBy ?? null,
        lastActivityAt: new Date() }).where(eq(task.id, taskId))
      await tx.insert(activityLog).values({ id: id(), type, userId: actor, taskId, assistantId: current.assistantId, payload: { from: current.status, to: status, ...(reason && { reason }) } })
    })
    return this.get(taskId)
  }

  async addTag(actor: string, taskId: string, raw: string): Promise<void> {
    await this.ensureEditable(taskId)
    const label = normalizeTag(raw)
    if (!label) throw new BadRequestException('태그가 필요합니다')
    const key = tagKey(label)
    await this.db.transaction(async (tx) => {
      await tx.insert(tag).values({ key, label, kind: isSrTag(label) ? 'sr' : 'keyword' }).onConflictDoNothing()
      const added = await tx.insert(taskTag).values({ taskId, tagKey: key, addedBy: actor }).onConflictDoNothing().returning()
      if (added.length) {
        await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, taskId))
        await tx.insert(activityLog).values({ id: id(), type: 'tag.added', userId: actor, taskId, payload: { tag: label } })
      }
    })
  }

  async removeTag(actor: string, taskId: string, raw: string): Promise<void> {
    await this.ensureEditable(taskId)
    await this.db.transaction(async (tx) => {
      const removed = await tx.delete(taskTag).where(and(eq(taskTag.taskId, taskId), eq(taskTag.tagKey, tagKey(raw)))).returning()
      if (removed.length) await tx.insert(activityLog).values({ id: id(), type: 'tag.removed', userId: actor, taskId, payload: { tag: normalizeTag(raw) } })
    })
  }

  async suggestions(prefix: string, exclude: string[] = []) {
    return tagSuggestions(await this.list(), [], prefix, exclude)
  }

  async messages(threadId: string) {
    const [target] = await this.db.select().from(thread).where(eq(thread.id, threadId))
    if (!target?.taskId) throw new NotFoundException('스레드를 찾을 수 없습니다')
    return (await this.db.select().from(message).where(eq(message.threadId, threadId)).orderBy(message.seq)).map((row) => ({
      id: row.id, threadId: row.threadId, seq: row.seq, role: row.role, kind: row.kind,
      content: row.content, authorId: row.authorId, status: row.status, createdAt: row.createdAt.toISOString(), attachmentIds: [],
    }))
  }

  async appendMessage(actor: string, threadId: string, input: { content: string; kind: 'discussion' }) {
    if (input.kind !== 'discussion') throw new BadRequestException('AI 요청은 S3에서 지원합니다')
    if (!input.content?.trim()) throw new BadRequestException('내용이 필요합니다')
    const [target] = await this.db.select().from(thread).where(eq(thread.id, threadId))
    if (!target?.taskId) throw new NotFoundException('스레드를 찾을 수 없습니다')
    await this.ensureEditable(target.taskId)
    const messageId = id()
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${threadId}))`)
      const [max] = await tx.select({ value: sql<number>`coalesce(max(${message.seq}), 0)` }).from(message).where(eq(message.threadId, threadId))
      await tx.insert(message).values({ id: messageId, threadId, seq: Number(max?.value ?? 0) + 1, role: 'user', kind: 'discussion', content: input.content.trim(), authorId: actor, status: 'done' })
      await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, target.taskId!))
      await tx.insert(activityLog).values({ id: id(), type: 'message.sent', userId: actor, taskId: target.taskId, payload: { kind: 'discussion' } })
    })
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
    await this.row(taskId)
    const ownFiles = await this.db.select({ id: fileObject.id }).from(fileObject).where(eq(fileObject.originTaskId, taskId))
    if (ownFiles.length) {
      const used = await this.db.select().from(taskInput).where(inArray(taskInput.fileId, ownFiles.map((file) => file.id)))
      if (used.some((item) => item.taskId !== taskId)) throw new ConflictException('다른 대화가 이 대화의 파일을 입력으로 사용합니다')
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(thread).where(eq(thread.taskId, taskId))
      await tx.delete(taskInput).where(eq(taskInput.taskId, taskId))
      if (ownFiles.length) {
        const fileIds = ownFiles.map((file) => file.id)
        await tx.update(fileObject).set({ previousId: null }).where(inArray(fileObject.id, fileIds))
        await tx.delete(fileObject).where(inArray(fileObject.id, fileIds))
      }
      await tx.delete(task).where(eq(task.id, taskId))
    })
  }
}
