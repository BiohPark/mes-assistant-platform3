import { randomUUID } from 'node:crypto'
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { buildTaskReport, type Message, type Note } from '@mes/domain'
import { reviewChecklist, type ChatProvider } from '@mes/llm'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module.js'
import { activityLog, appUser, assistant, chatRequest, checklistItem, checklistReview, checklistReviewItem, code, conversationInput, fileObject, message, note, noteAttachment, task, taskFeedback, taskInput, thread } from '../db/schema.js'
import { EventsService } from '../events/events.service.js'
import { FILE_STORAGE } from '../files/files.service.js'
import { createStorageKey, FileStorageService, sha256 } from '../files/fileStorage.service.js'
import { LLM_PROVIDER } from '../llm/provider.token.js'
import { RequestsService } from '../requests/requests.service.js'
import { assertFileAccess, assertTaskAccess } from '../sr/access.js'
import { DbTasksService } from './tasks.service.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
const id = () => randomUUID()

@Injectable()
export class TaskExtrasService {
  constructor(@Inject(DB) private readonly db: Db, @Inject(LLM_PROVIDER) private readonly provider: ChatProvider,
    @Inject(RequestsService) private readonly requests: RequestsService, @Inject(FILE_STORAGE) private readonly storage: FileStorageService,
    @Inject(EventsService) private readonly events: EventsService) {}

  private async editable(tx: Tx, taskId: string) {
    const [row] = await tx.select().from(task).where(and(eq(task.id, taskId), isNull(task.deletedAt))).for('update')
    if (!row) throw new NotFoundException('대화를 찾을 수 없습니다')
    if (row.status === 'done') throw new ConflictException('완료된 대화는 재개한 뒤 수정하세요')
    return row
  }

  private updated(taskId: string) { this.events.publish('task.updated', { taskId }) }

  async checklist(actor: string, taskId: string) {
    return (await new DbTasksService(this.db).get(taskId, actor)).checklist
  }

  async addChecklist(actor: string, taskId: string, label: string, required = false) {
    await assertTaskAccess(this.db, actor, taskId)
    const clean = label.trim()
    if (!clean) throw new BadRequestException('항목 이름이 필요합니다')
    await this.db.transaction(async (tx) => {
      await this.editable(tx, taskId)
      const [last] = await tx.select({ sortOrder: checklistItem.sortOrder }).from(checklistItem).where(eq(checklistItem.taskId, taskId)).orderBy(desc(checklistItem.sortOrder)).limit(1)
      await tx.insert(checklistItem).values({ id: id(), taskId, sortOrder: (last?.sortOrder ?? -1) + 1, label: clean, required })
      await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, taskId))
    })
    this.updated(taskId)
    return this.checklist(actor, taskId)
  }

  async removeChecklist(actor: string, taskId: string, itemId: string) {
    await assertTaskAccess(this.db, actor, taskId)
    await this.db.transaction(async (tx) => {
      await this.editable(tx, taskId)
      const [item] = await tx.select().from(checklistItem).where(and(eq(checklistItem.id, itemId), eq(checklistItem.taskId, taskId)))
      if (!item) throw new NotFoundException('체크리스트 항목을 찾을 수 없습니다')
      await tx.delete(checklistReview).where(eq(checklistReview.taskId, taskId))
      await tx.delete(checklistItem).where(eq(checklistItem.id, itemId))
      await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, taskId))
    })
    this.updated(taskId)
  }

  async toggleChecklist(actor: string, taskId: string, itemId: string) {
    await assertTaskAccess(this.db, actor, taskId)
    await this.db.transaction(async (tx) => {
      await this.editable(tx, taskId)
      const [item] = await tx.select().from(checklistItem).where(and(eq(checklistItem.id, itemId), eq(checklistItem.taskId, taskId)))
      if (!item) throw new NotFoundException('체크리스트 항목을 찾을 수 없습니다')
      await tx.update(checklistItem).set({ checked: !item.checked, checkedBy: item.checked ? null : actor, checkedAt: item.checked ? null : new Date() }).where(eq(checklistItem.id, itemId))
      await tx.insert(activityLog).values({ id: id(), type: item.checked ? 'checklist.unchecked' : 'checklist.checked', userId: actor, taskId, payload: { label: item.label } })
      await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, taskId))
    })
    this.updated(taskId)
    return this.checklist(actor, taskId)
  }

  async review(actor: string, taskId: string) {
    const current = await new DbTasksService(this.db).get(taskId, actor)
    if (current.status === 'done') throw new ConflictException('완료된 대화는 재개한 뒤 수정하세요')
    const [agent] = await this.db.select().from(assistant).where(eq(assistant.id, current.assistantId))
    const rows = current.threadId ? await this.db.select().from(message).where(eq(message.threadId, current.threadId)).orderBy(message.seq) : []
    const history: Message[] = rows.map((row) => ({ id: row.id, threadId: row.threadId, seq: row.seq,
      role: row.role as Message['role'], kind: row.kind as Message['kind'], content: row.content, status: row.status as Message['status'],
      createdAt: row.createdAt.toISOString(), attachmentIds: [], ...(row.authorId && { authorId: row.authorId }) }))
    const result = await this.requests.runAuxiliary(actor, 'checklist', (signal) => reviewChecklist(this.provider,
      current.modelId ?? agent?.modelId ?? 'glm-5.2', current.checklist, history, actor, signal))
    await this.db.transaction(async (tx) => {
      await this.editable(tx, taskId)
      const latest = await tx.select({ id: checklistItem.id }).from(checklistItem).where(eq(checklistItem.taskId, taskId))
      if (latest.length !== result.total || latest.some((item) => !result.items.some((entry) => entry.itemId === item.id))) throw new ConflictException('체크리스트가 변경되었습니다. 다시 점검하세요')
      const reviewId = id()
      await tx.insert(checklistReview).values({ id: reviewId, taskId, byUser: actor, at: new Date(result.at), met: result.met, total: result.total, source: result.source })
      if (result.items.length) await tx.insert(checklistReviewItem).values(result.items.map((item) => ({ reviewId, itemId: item.itemId, met: item.met, note: item.note })))
      await tx.insert(activityLog).values({ id: id(), type: 'checklist.reviewed', userId: actor, taskId, payload: { met: result.met, total: result.total, source: result.source } })
      await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, taskId))
    })
    this.updated(taskId)
    return result
  }

  async applyReview(actor: string, taskId: string) {
    await assertTaskAccess(this.db, actor, taskId)
    const count = await this.db.transaction(async (tx) => {
      await this.editable(tx, taskId)
      const [review] = await tx.select().from(checklistReview).where(eq(checklistReview.taskId, taskId)).orderBy(desc(checklistReview.at)).limit(1)
      if (!review) throw new NotFoundException('AI 달성도 결과가 없습니다')
      const rows = await tx.select({ item: checklistItem }).from(checklistReviewItem).innerJoin(checklistItem, eq(checklistReviewItem.itemId, checklistItem.id))
        .where(and(eq(checklistReviewItem.reviewId, review.id), eq(checklistReviewItem.met, true), eq(checklistItem.taskId, taskId), eq(checklistItem.checked, false)))
      for (const { item } of rows) {
        await tx.update(checklistItem).set({ checked: true, checkedBy: actor, checkedAt: new Date() }).where(eq(checklistItem.id, item.id))
        await tx.insert(activityLog).values({ id: id(), type: 'checklist.checked', userId: actor, taskId, payload: { label: item.label } })
      }
      if (rows.length) await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, taskId))
      return rows.length
    })
    this.updated(taskId)
    return { applied: count }
  }

  async notes(actor: string, taskId: string): Promise<Note[]> {
    await assertTaskAccess(this.db, actor, taskId)
    const [active] = await this.db.select({ id: task.id }).from(task).where(and(eq(task.id, taskId), isNull(task.deletedAt)))
    if (!active) throw new NotFoundException('대화를 찾을 수 없습니다')
    const rows = await this.db.select().from(note).where(eq(note.taskId, taskId)).orderBy(note.createdAt)
    if (!rows.length) return []
    const attachments = await this.db.select().from(noteAttachment).where(inArray(noteAttachment.noteId, rows.map((row) => row.id)))
    return rows.map((row) => ({ id: row.id, taskId, authorId: row.authorId, content: row.content, createdAt: row.createdAt.toISOString(),
      attachmentIds: attachments.filter((item) => item.noteId === row.id).map((item) => item.fileId) }))
  }

  async addNote(actor: string, taskId: string, content: string, attachmentIds: string[] = []) {
    await assertTaskAccess(this.db, actor, taskId)
    const clean = content.trim()
    const unique = [...new Set(attachmentIds)]
    if (!clean && !unique.length) throw new BadRequestException('노트 본문이나 첨부가 필요합니다')
    for (const fileId of unique) await assertFileAccess(this.db, actor, fileId)
    const noteId = id()
    await this.db.transaction(async (tx) => {
      await this.editable(tx, taskId)
      if (unique.length) {
        const files = await tx.select().from(fileObject).where(and(inArray(fileObject.id, unique), eq(fileObject.kind, 'task_file'), isNull(fileObject.deletedAt)))
        if (files.length !== unique.length) throw new BadRequestException('자료함 파일만 첨부할 수 있습니다')
      }
      await tx.insert(note).values({ id: noteId, taskId, authorId: actor, content: clean })
      if (unique.length) await tx.insert(noteAttachment).values(unique.map((fileId) => ({ noteId, fileId })))
      await tx.insert(activityLog).values({ id: id(), type: 'note.added', userId: actor, taskId, payload: { preview: clean.slice(0, 60) } })
      await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, taskId))
    })
    this.updated(taskId)
    return (await this.notes(actor, taskId)).find((item) => item.id === noteId)!
  }

  async deleteNote(actor: string, taskId: string, noteId: string) {
    await assertTaskAccess(this.db, actor, taskId)
    await this.db.transaction(async (tx) => {
      await this.editable(tx, taskId)
      const [row] = await tx.select().from(note).where(and(eq(note.id, noteId), eq(note.taskId, taskId)))
      if (!row) throw new NotFoundException('노트를 찾을 수 없습니다')
      const [user] = await tx.select().from(appUser).where(eq(appUser.id, actor))
      if (row.authorId !== actor && !user?.isSystemOwner) throw new ForbiddenException('작성자만 삭제할 수 있습니다')
      await tx.delete(note).where(eq(note.id, noteId))
      await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, taskId))
    })
    this.updated(taskId)
  }

  private async report(tx: Db | Tx, taskId: string, actor: string, now: Date, feedback?: { rating: number; comment: string }) {
    const detail = await new DbTasksService(tx as Db).get(taskId)
    detail.completedAt = now.toISOString()
    detail.completedBy = actor
    if (feedback) detail.feedback = { ...feedback, by: actor, at: now.toISOString() }
    const [agent] = await tx.select().from(assistant).where(eq(assistant.id, detail.assistantId))
    if (!agent) throw new NotFoundException('에이전트를 찾을 수 없습니다')
    const [level1, level2] = await Promise.all([
      tx.select().from(code).where(eq(code.id, agent.level1CodeId)), tx.select().from(code).where(eq(code.id, agent.level2CodeId)),
    ])
    const files = await tx.select().from(fileObject).where(and(eq(fileObject.originTaskId, taskId), isNull(fileObject.deletedAt)))
    const selectedFiles = await tx.select({ row: taskInput, file: fileObject, origin: task, originAssistant: assistant })
      .from(taskInput).innerJoin(fileObject, eq(taskInput.fileId, fileObject.id)).innerJoin(task, eq(fileObject.originTaskId, task.id))
      .innerJoin(assistant, eq(task.assistantId, assistant.id)).where(eq(taskInput.taskId, taskId))
    const selectedConversations = await tx.select({ row: conversationInput, source: task, originAssistant: assistant })
      .from(conversationInput).innerJoin(task, eq(conversationInput.sourceTaskId, task.id)).innerJoin(assistant, eq(task.assistantId, assistant.id))
      .where(eq(conversationInput.taskId, taskId))
    const users = await tx.select({ id: appUser.id, name: appUser.name }).from(appUser)
    return buildTaskReport({ task: detail, assistant: { name: agent.name, level1: level1[0]?.name ?? '', level2: level2[0]?.name ?? '' },
      files: files.map((file) => ({ id: file.id, name: file.originalName })),
      inputs: [
        ...selectedFiles.map(({ row, file, originAssistant }) => ({ name: file.originalName, version: file.version, weight: row.weight as 'main' | 'reference', fromAssistantName: file.originTaskId === taskId ? '이 대화' : originAssistant.name })),
        ...selectedConversations.map(({ row, source, originAssistant }) => ({ name: `${source.code} ${source.title}`, version: 1, weight: row.weight as 'main' | 'reference', fromAssistantName: originAssistant.name })),
      ], users: new Map(users.map((user) => [user.id, { name: user.name }])), now })
  }

  async preview(actor: string, taskId: string, feedback?: { rating: number; comment: string }) {
    await assertTaskAccess(this.db, actor, taskId)
    if (feedback && (feedback.rating < 1 || feedback.rating > 5 || !Number.isInteger(feedback.rating))) throw new BadRequestException('별점은 1~5여야 합니다')
    return { content: await this.report(this.db, taskId, actor, new Date(), feedback) }
  }

  async complete(actor: string, taskId: string, feedback?: { rating: number; comment: string }) {
    await assertTaskAccess(this.db, actor, taskId)
    if (feedback && (feedback.rating < 1 || feedback.rating > 5 || !Number.isInteger(feedback.rating))) throw new BadRequestException('별점은 1~5여야 합니다')
    const storageKey = createStorageKey('완료리포트.md')
    let written = false
    try {
      await this.db.transaction(async (tx) => {
        const current = await this.editable(tx, taskId)
        const [active] = await tx.select({ id: chatRequest.id }).from(chatRequest).innerJoin(thread, eq(chatRequest.threadId, thread.id))
          .where(and(eq(thread.taskId, taskId), inArray(chatRequest.status, ['pending', 'streaming']))).limit(1)
        if (active) throw new ConflictException({ code: 'REQUEST_ACTIVE' })
        const now = new Date()
        if (feedback) {
          await tx.insert(taskFeedback).values({ taskId, rating: feedback.rating, comment: feedback.comment, byUser: actor, at: now })
            .onDuplicateKeyUpdate({ set: { rating: feedback.rating, comment: feedback.comment, byUser: actor, at: now } })
          await tx.insert(activityLog).values({ id: id(), type: 'feedback.given', userId: actor, taskId, assistantId: current.assistantId, payload: { rating: feedback.rating } })
        }
        const content = await this.report(tx, taskId, actor, now, feedback)
        const bytes = Buffer.from(content, 'utf8')
        await this.storage.write(storageKey, bytes)
        written = true
        const name = `완료리포트_${current.code}.md`
        const [prev] = await tx.select().from(fileObject).where(and(eq(fileObject.originTaskId, taskId), eq(fileObject.originalName, name), isNull(fileObject.deletedAt))).orderBy(desc(fileObject.version)).limit(1)
        if (prev?.isOutput) await tx.update(fileObject).set({ isOutput: false }).where(eq(fileObject.id, prev.id))
        await tx.insert(fileObject).values({ id: id(), kind: 'task_file', originTaskId: taskId, originalName: name,
          mime: 'text/markdown', sizeBytes: bytes.byteLength, sha256: sha256(bytes), storageKey, source: 'assistant', isOutput: true,
          version: (prev?.version ?? 0) + 1, previousId: prev?.id, uploadedBy: actor })
        await tx.update(task).set({ status: 'done', completedAt: now, completedBy: actor, lastActivityAt: now }).where(eq(task.id, taskId))
        const missingRequired = (await tx.select({ required: checklistItem.required, checked: checklistItem.checked }).from(checklistItem).where(eq(checklistItem.taskId, taskId)))
          .filter((item) => item.required && !item.checked).length
        await tx.insert(activityLog).values({ id: id(), type: 'task.completed', userId: actor, taskId, assistantId: current.assistantId,
          payload: { from: current.status, to: 'done', missingRequired } })
      })
    } catch (error) { if (written) await this.storage.remove(storageKey); throw error }
    this.updated(taskId)
    this.events.publish('file.updated', { taskId })
    return new DbTasksService(this.db).get(taskId, actor)
  }
}
