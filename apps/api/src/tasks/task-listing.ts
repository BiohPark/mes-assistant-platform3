import { BadRequestException } from '@nestjs/common'
import { TASK_PAGE_SIZE, TASK_PAGE_MAX, type TaskAiFilter } from '@mes/contracts'
import { tagKey, type TaskSummary, type TaskBoard, type TaskAiRequestStatus } from '@mes/domain'
import { and, desc, eq, exists, gte, getTableColumns, inArray, isNull, not, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'
import type { Db } from '../db/db.module.js'
import { appUser, assistant, chatRequest, checklistItem, fileObject, serviceRequest, tag, task, taskAssignee, taskInput, taskTag, thread } from '../db/schema.js'

export interface TaskFilter {
  assistantId?: string
  status?: string[]
  tags?: string[]
  mine?: string
  q?: string
  ai?: TaskAiFilter[]
  activeWithinDays?: number
  limit?: number
  cursor?: string
  view?: 'summary'
}

// Keep all six fractional digits: Date/toISOString alone loses microseconds from DATETIME(6).
const cursorTime = sql<string>`date_format(${task.lastActivityAt}, '%Y-%m-%d %H:%i:%s.%f')`
type CursorRow = { id: string; cursorTime: string }
export const encodeTaskCursor = (row: CursorRow) => Buffer.from(JSON.stringify([row.cursorTime, row.id])).toString('base64url')
export function decodeTaskCursor(cursor: string): { at: string; id: string } {
  try {
    if (!/^[A-Za-z0-9_-]{1,1024}$/.test(cursor)) throw new Error()
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'string'
      || !value[1] || value[1].length > 191 || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value[0])
      || !Number.isFinite(Date.parse(value[0].replace(' ', 'T') + 'Z'))) throw new Error()
    return { at: value[0], id: value[1] }
  } catch { throw new BadRequestException('커서가 올바르지 않습니다') }
}
const afterCursor = (cursor?: string) => {
  if (!cursor) return undefined
  const { at, id } = decodeTaskCursor(cursor)
  return or(sql`${task.lastActivityAt} < ${at}`, and(sql`${task.lastActivityAt} = ${at}`, sql`${task.id} < ${id}`))
}
export const taskPageLimit = (limit = TASK_PAGE_SIZE) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > TASK_PAGE_MAX) throw new BadRequestException('목록 개수는 1~200이어야 합니다')
  return limit
}
export const shownAiStatuses: TaskAiRequestStatus[] = ['pending', 'streaming', 'failed', 'interrupted']
export function pickedTaskRequest(db: Db) {
  const active = alias(chatRequest, 'list_active_request')
  const latest = alias(chatRequest, 'list_latest_request')
  const activeId = db.select({ id: active.id }).from(active).where(eq(active.activeThreadId, thread.id))
  const latestId = db.select({ id: latest.id }).from(latest).where(eq(latest.threadId, thread.id)).orderBy(desc(latest.createdAt), desc(latest.id)).limit(1)
  return sql`coalesce((${activeId}), (${latestId}))`
}

export class TaskListing {
  constructor(private readonly db: Db) {}

  async viewer(actor?: string) {
    const [viewer] = actor ? await this.db.select({ isBusinessOwner: appUser.isBusinessOwner, isSystemOwner: appUser.isSystemOwner }).from(appUser).where(eq(appUser.id, actor)) : []
    return viewer
  }

  visibility(actor: string | undefined, viewer: Awaited<ReturnType<TaskListing['viewer']>>) {
    return and(isNull(task.deletedAt), viewer?.isBusinessOwner && !viewer.isSystemOwner ? or(
      eq(task.createdBy, actor!), eq(task.ownerId, actor!),
      exists(this.db.select({ id: taskAssignee.taskId }).from(taskAssignee).where(and(eq(taskAssignee.taskId, task.id), eq(taskAssignee.userId, actor!)))),
    ) : undefined)!
  }

  async conditions(filter: TaskFilter, actor?: string) {
    const viewer = await this.viewer(actor)
    const q = filter.q?.trim().toLowerCase()
    const ai = [...new Set((filter.ai ?? []).flatMap(value => value === 'responding' ? ['pending', 'streaming'] : value === 'failed' ? ['failed', 'interrupted'] : [value]))]
    const selectedRequest = this.db.select({ id: chatRequest.id }).from(thread).innerJoin(chatRequest, eq(chatRequest.id, pickedTaskRequest(this.db)))
      .where(and(eq(thread.taskId, task.id), inArray(chatRequest.status, shownAiStatuses)))
    const matchingRequest = this.db.select({ id: chatRequest.id }).from(thread).innerJoin(chatRequest, eq(chatRequest.id, pickedTaskRequest(this.db)))
      .where(and(eq(thread.taskId, task.id), inArray(chatRequest.status, ai.filter(value => value !== 'none'))))
    return and(this.visibility(actor, viewer),
      filter.assistantId ? eq(task.assistantId, filter.assistantId) : undefined,
      filter.status?.length ? inArray(task.status, filter.status) : undefined,
      filter.mine ? or(eq(task.ownerId, filter.mine), exists(this.db.select({ id: taskAssignee.taskId }).from(taskAssignee).where(and(eq(taskAssignee.taskId, task.id), eq(taskAssignee.userId, filter.mine))))) : undefined,
      ...[...new Set((filter.tags ?? []).map(tagKey))].map(key => exists(this.db.select({ id: taskTag.taskId }).from(taskTag).where(and(eq(taskTag.taskId, task.id), eq(taskTag.tagKey, key))))),
      q ? or(sql`locate(${q}, lower(${task.code})) > 0`, sql`locate(${q}, lower(${task.title})) > 0`,
        exists(this.db.select({ id: taskTag.taskId }).from(taskTag).innerJoin(tag, eq(tag.key, taskTag.tagKey))
          .where(and(eq(taskTag.taskId, task.id), sql`locate(${q}, lower(${tag.label})) > 0`)))) : undefined,
      filter.activeWithinDays !== undefined ? gte(task.lastActivityAt, new Date(Date.now() - filter.activeWithinDays * 86_400_000)) : undefined,
      ai.length ? or(ai.some(value => value !== 'none') ? exists(matchingRequest) : undefined, ai.includes('none') ? not(exists(selectedRequest)) : undefined) : undefined,
    )!
  }

  async detailRows(filter: TaskFilter, actor?: string, page = false) {
    const conditions = await this.conditions(filter, actor)
    const query = this.db.select({ ...getTableColumns(task), cursorTime }).from(task).where(and(conditions, afterCursor(filter.cursor)))
      .orderBy(desc(task.lastActivityAt), desc(task.id)).$dynamic()
    return page || filter.limit !== undefined || filter.cursor ? query.limit(taskPageLimit(filter.limit) + (page ? 1 : 0)) : query
  }

  /** One scalar-count projection plus two batched relation queries, independent of card count. */
  async summaries(condition: SQL, limit?: number): Promise<Array<TaskSummary & CursorRow>> {
    const query = this.db.select({
      id: task.id, code: task.code, assistantId: task.assistantId, title: task.title, titleSource: task.titleSource,
      status: task.status, ownerId: task.ownerId, priority: task.priority, dueDate: task.dueDate,
      createdAt: task.createdAt, createdBy: task.createdBy, lastActivityAt: task.lastActivityAt, cursorTime,
      startedAt: task.startedAt, completedAt: task.completedAt, completedBy: task.completedBy, threadId: thread.id,
      startedSrCode: serviceRequest.code,
      inputCount: sql<number>`(select count(*) from ${taskInput} where ${taskInput.taskId} = ${task.id})`.mapWith(Number),
      outputCount: sql<number>`(select count(*) from ${fileObject} where ${fileObject.originTaskId} = ${task.id} and ${fileObject.isOutput} = true and ${fileObject.deletedAt} is null)`.mapWith(Number),
      checkTotal: sql<number>`(select count(*) from ${checklistItem} where ${checklistItem.taskId} = ${task.id})`.mapWith(Number),
      checkDone: sql<number>`(select count(*) from ${checklistItem} where ${checklistItem.taskId} = ${task.id} and ${checklistItem.checked} = true)`.mapWith(Number),
      aiStatus: chatRequest.status, aiPhase: chatRequest.phase, aiCreated: chatRequest.createdAt, aiFinished: chatRequest.finishedAt,
    }).from(task).leftJoin(thread, eq(thread.taskId, task.id)).leftJoin(serviceRequest, eq(serviceRequest.id, task.srId))
      .leftJoin(chatRequest, and(eq(chatRequest.id, pickedTaskRequest(this.db)), inArray(chatRequest.status, shownAiStatuses)))
      .where(condition).orderBy(desc(task.lastActivityAt), desc(task.id)).$dynamic()
    const rows = await (limit ? query.limit(limit) : query)
    if (!rows.length) return []
    const ids = rows.map(row => row.id)
    const [tags, assignees] = await Promise.all([
      this.db.select({ taskId: taskTag.taskId, label: tag.label, srCode: serviceRequest.code }).from(taskTag)
        .innerJoin(tag, eq(tag.key, taskTag.tagKey)).leftJoin(serviceRequest, and(sql`${taskTag.tagKey} like 'sr-%'`, eq(serviceRequest.code, sql`upper(${taskTag.tagKey})`)))
        .where(inArray(taskTag.taskId, ids)).orderBy(taskTag.addedAt, taskTag.tagKey),
      this.db.select().from(taskAssignee).where(inArray(taskAssignee.taskId, ids)),
    ])
    const tagsByTask = new Map<string, typeof tags>()
    const assigneesByTask = new Map<string, string[]>()
    for (const item of tags) { const group = tagsByTask.get(item.taskId); if (group) group.push(item); else tagsByTask.set(item.taskId, [item]) }
    for (const item of assignees) { const group = assigneesByTask.get(item.taskId); if (group) group.push(item.userId); else assigneesByTask.set(item.taskId, [item.userId]) }
    return rows.map(row => {
      const tags = tagsByTask.get(row.id) ?? []
      return {
        id: row.id, code: row.code, assistantId: row.assistantId, title: row.title, titleSource: row.titleSource as TaskSummary['titleSource'],
        status: row.status as TaskSummary['status'], ownerId: row.ownerId, priority: row.priority as TaskSummary['priority'],
        assigneeIds: assigneesByTask.get(row.id) ?? [], tags: tags.map(item => item.label),
        linkedSrCodes: [...new Set([row.startedSrCode, ...tags.map(item => item.srCode)].filter((code): code is string => !!code))],
        checklist: { checked: row.checkDone, total: row.checkTotal }, inputCount: row.inputCount, outputCount: row.outputCount,
        ...(row.dueDate && { dueDate: row.dueDate }), ...(row.threadId && { threadId: row.threadId }),
        createdAt: row.createdAt.toISOString(), createdBy: row.createdBy, lastActivityAt: row.lastActivityAt.toISOString(), cursorTime: row.cursorTime,
        ...(row.startedAt && { startedAt: row.startedAt.toISOString() }), ...(row.completedAt && { completedAt: row.completedAt.toISOString() }), ...(row.completedBy && { completedBy: row.completedBy }),
        aiRequest: row.aiStatus ? { status: row.aiStatus as TaskAiRequestStatus, ...(row.aiPhase && { phase: row.aiPhase }), updatedAt: (row.aiFinished ?? row.aiCreated)!.toISOString() } : null,
      }
    })
  }

  async summaryPage(filter: TaskFilter, actor?: string) {
    const limit = taskPageLimit(filter.limit)
    const condition = await this.conditions(filter, actor)
    const rows = await this.summaries(and(condition, afterCursor(filter.cursor))!, limit + 1)
    const page = rows.slice(0, limit)
    return { items: page.map(({ cursorTime: _cursorTime, ...item }) => item), nextCursor: rows.length > limit ? encodeTaskCursor(page.at(-1)!) : null }
  }

  async board(filter: TaskFilter, actor?: string): Promise<TaskBoard> {
    const limit = taskPageLimit(filter.limit)
    const condition = await this.conditions(filter, actor)
    // MariaDB 10.4 supports window functions; one query selects all columns' top N IDs.
    const ranked = this.db.select({ id: task.id, rank: sql<number>`row_number() over (partition by ${task.assistantId} order by ${task.lastActivityAt} desc, ${task.id} desc)`.as('task_rank') })
      .from(task).where(and(condition, afterCursor(filter.cursor))).as('ranked_tasks')
    const [counts, top] = await Promise.all([
      this.db.select({ assistantId: assistant.id, total: sql<number>`count(${task.id})`.mapWith(Number) }).from(assistant)
        .leftJoin(task, and(eq(task.assistantId, assistant.id), condition)).where(filter.assistantId ? eq(assistant.id, filter.assistantId) : undefined)
        .groupBy(assistant.id, assistant.sortOrder).orderBy(assistant.sortOrder, assistant.id),
      this.db.select({ id: ranked.id }).from(ranked).where(sql`${ranked.rank} <= ${limit + 1}`),
    ])
    const summaries = top.length ? await this.summaries(and(condition, inArray(task.id, top.map(row => row.id)))!) : []
    const byAssistant = new Map<string, typeof summaries>()
    for (const row of summaries) { const group = byAssistant.get(row.assistantId); if (group) group.push(row); else byAssistant.set(row.assistantId, [row]) }
    return { columns: counts.map(column => {
      const rows = byAssistant.get(column.assistantId) ?? []
      const page = rows.slice(0, limit)
      return { ...column, items: page.map(({ cursorTime: _cursorTime, ...item }) => item), nextCursor: rows.length > limit ? encodeTaskCursor(page.at(-1)!) : null }
    }) }
  }
}

