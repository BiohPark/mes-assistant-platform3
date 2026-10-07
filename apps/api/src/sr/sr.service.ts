import { randomUUID } from 'node:crypto'
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { draftFromConversation } from '@mes/domain'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module.js'
import { activityLog, appSetting, appUser, assistant, chatRequest, dbLock, fileObject, message, messageAttachment, serviceRequest, sharedResult, sharedResultFile, tag, task, thread } from '../db/schema.js'
import { DbTasksService } from '../tasks/tasks.service.js'
import { EventsService } from '../events/events.service.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { RequestsService } from '../requests/requests.service.js'
import { CONFIG, type AppConfig } from '../config/config.js'
import { FileStorageService } from '../files/fileStorage.service.js'
import { assertSrAccess } from './access.js'

const id = () => randomUUID()
type SrStatus = 'submitted' | 'reviewing' | 'in_progress' | 'responded' | 'done' | 'rejected'

@Injectable()
export class SrService {
  private readonly notifications: NotificationsService
  constructor(@Inject(DB) private readonly db: Db, @Inject(DbTasksService) private readonly tasks: DbTasksService,
    @Inject(EventsService) events: EventsService, @Optional() @Inject(NotificationsService) notifications?: NotificationsService,
    @Optional() @Inject(RequestsService) private readonly requests?: RequestsService,
    @Optional() @Inject(CONFIG) private readonly config?: AppConfig) {
    this.notifications = notifications ?? new NotificationsService(db, events)
  }

  private async user(actor: string) {
    const [user] = await this.db.select().from(appUser).where(eq(appUser.id, actor))
    if (!user) throw new ForbiddenException('사용자를 찾을 수 없습니다')
    return user
  }
  private async row(srId: string) {
    const [row] = await this.db.select().from(serviceRequest).where(eq(serviceRequest.id, srId))
    if (!row) throw new NotFoundException('SR을 찾을 수 없습니다')
    return row
  }
  private async view(actor: string, srId: string) {
    const [user, row] = await Promise.all([this.user(actor), this.row(srId)])
    if (user.isBusinessOwner && !user.isSystemOwner && row.requesterId !== actor) throw new ForbiddenException('자신의 SR만 볼 수 있습니다')
    return row
  }
  private async manager(actor: string, srId: string) {
    const user = await this.user(actor)
    if (user.isBusinessOwner && !user.isSystemOwner) throw new ForbiddenException('담당자 권한이 필요합니다')
    await assertSrAccess(this.db, actor, srId)
  }
  private async starter(actor: string, srId: string) {
    const user = await this.user(actor)
    if (user.isBusinessOwner && !user.isSystemOwner) throw new ForbiddenException('담당자 권한이 필요합니다')
    try { await assertSrAccess(this.db, actor, srId); return }
    catch (error) { if (!(error instanceof ForbiddenException)) throw error }
    const [setting] = await this.db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'srIntakeAssistantId'))
    if (typeof setting?.value === 'string') {
      const [intake] = await this.db.select({ ownerId: assistant.ownerId }).from(assistant).where(eq(assistant.id, setting.value))
      if (intake?.ownerId === actor) return
    }
    throw new ForbiddenException('연결 업무를 시작할 수 없습니다')
  }
  private async saveContentAttachments(tx: Parameters<Parameters<Db['transaction']>[0]>[0], srId: string, body: string, attachmentIds: string[]) {
    const [srThread] = await tx.select({ id: thread.id }).from(thread).where(eq(thread.srId, srId)).for('update')
    if (!srThread) throw new NotFoundException('접수 대화를 찾을 수 없습니다')
    const [existing] = await tx.select({ id: message.id }).from(message)
      .where(and(eq(message.threadId, srThread.id), eq(message.role, 'user'), eq(message.kind, 'discussion'), isNull(message.authorId)))
    if (existing) {
      await tx.update(message).set({ content: body }).where(eq(message.id, existing.id))
      await tx.delete(messageAttachment).where(eq(messageAttachment.messageId, existing.id))
    } else if (!body && !attachmentIds.length) return
    else {
      const [last] = await tx.select({ seq: sql<number>`coalesce(max(${message.seq}), 0)` }).from(message).where(eq(message.threadId, srThread.id))
      const messageId = id()
      await tx.insert(message).values({ id: messageId, threadId: srThread.id, seq: Number(last?.seq ?? 0) + 1,
        role: 'user', kind: 'discussion', content: body, status: 'done' })
      if (attachmentIds.length) await tx.insert(messageAttachment).values(attachmentIds.map((fileId) => ({ messageId, fileId })))
      return
    }
    if (attachmentIds.length) await tx.insert(messageAttachment).values(attachmentIds.map((fileId) => ({ messageId: existing.id, fileId })))
  }
  private async assemble(row: typeof serviceRequest.$inferSelect, includeInternal: boolean) {
    const [srThread] = await this.db.select().from(thread).where(eq(thread.srId, row.id))
    const [attachments, results, linked] = await Promise.all([
      srThread ? this.db.select({ id: messageAttachment.fileId }).from(messageAttachment)
        .innerJoin(message, eq(messageAttachment.messageId, message.id)).innerJoin(fileObject, eq(messageAttachment.fileId, fileObject.id))
        .where(and(eq(message.threadId, srThread.id), eq(fileObject.originSrId, row.id), isNull(fileObject.deletedAt))).orderBy(message.seq) : Promise.resolve([]),
      this.db.select().from(sharedResult).where(eq(sharedResult.srId, row.id)).orderBy(sharedResult.at),
      this.db.select({ id: task.id, code: task.code, title: task.title, status: task.status, threadId: thread.id }).from(task)
        .leftJoin(thread, eq(thread.taskId, task.id)).where(and(eq(task.srId, row.id), isNull(task.deletedAt))),
    ])
    const files = results.length ? await this.db.select().from(sharedResultFile).where(inArray(sharedResultFile.resultId, results.map((item) => item.id))) : []
    return { ...row, code: row.code ?? '', threadId: srThread?.id ?? '', attachmentIds: [...new Set(attachments.map((item) => item.id))],
      results: results.map((item) => ({ id: item.id, ...(includeInternal && item.taskId && { taskId: item.taskId }), text: item.text, fileIds: files.filter((file) => file.resultId === item.id).map((file) => file.fileId), by: item.byUser, at: item.at.toISOString() })),
      conversations: includeInternal ? linked : [], submittedAt: row.submittedAt?.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
  }
  async create(actor: string) {
    await this.user(actor)
    const srId = id(), threadId = id()
    await this.db.transaction(async (tx) => {
      await tx.insert(serviceRequest).values({ id: srId, requesterId: actor, titleSource: 'default', status: 'draft' })
      await tx.insert(thread).values({ id: threadId, srId, title: '접수 대화', createdBy: actor })
    })
    return this.get(actor, srId)
  }
  async intakeAssistant() {
    const [setting] = await this.db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'srIntakeAssistantId'))
    return { srIntakeAssistantId: typeof setting?.value === 'string' ? setting.value : null }
  }
  async list(actor: string) {
    const user = await this.user(actor)
    const rows = await this.db.select().from(serviceRequest)
      .where(user.isBusinessOwner && !user.isSystemOwner ? eq(serviceRequest.requesterId, actor) : undefined)
      .orderBy(desc(serviceRequest.createdAt))
    return Promise.all(rows.map((row) => this.assemble(row, !user.isBusinessOwner || user.isSystemOwner)))
  }
  async get(actor: string, srId: string) {
    const [row, user] = await Promise.all([this.view(actor, srId), this.user(actor)])
    return this.assemble(row, !user.isBusinessOwner || user.isSystemOwner)
  }
  async draft(actor: string, srId: string) {
    await this.view(actor, srId)
    const [owner] = await this.db.select().from(thread).where(eq(thread.srId, srId))
    if (!owner) throw new NotFoundException('접수 대화를 찾을 수 없습니다')
    const rows = await this.db.select({ role: message.role, content: message.content, status: message.status }).from(message).where(eq(message.threadId, owner.id)).orderBy(message.seq)
    const draft = draftFromConversation(rows.filter((row) => row.status === 'done' && (row.role === 'user' || row.role === 'assistant')).map((row) => ({ role: row.role as 'user' | 'assistant', content: row.content })))
    const title = await this.requests?.suggestSrTitle(actor, owner.id).catch(() => undefined)
    return { ...draft, ...(title && { title }) }
  }
  async submit(actor: string, srId: string, input: { title: string; titleSource?: 'ai' | 'manual'; body: string; attachmentIds?: string[] }) {
    if (!input.title.trim()) throw new BadRequestException('제목을 입력하세요')
    const sr = await this.view(actor, srId)
    const user = await this.user(actor)
    if (sr.requesterId !== actor && !user.isSystemOwner) throw new ForbiddenException('요청자만 접수할 수 있습니다')
    if (sr.status !== 'draft') throw new ConflictException('이미 접수되었습니다')
    const attachmentIds = [...new Set(input.attachmentIds ?? [])]
    if (attachmentIds.length) {
      const valid = await this.db.select({ id: fileObject.id }).from(fileObject).where(and(inArray(fileObject.id, attachmentIds), eq(fileObject.originSrId, srId), isNull(fileObject.deletedAt)))
      if (valid.length !== attachmentIds.length) throw new BadRequestException('이 SR의 첨부만 선택할 수 있습니다')
    }
    await this.db.transaction(async (tx) => {
      const year = new Date().getFullYear(), lockKey = `sr-code:${year}`
      await tx.insert(dbLock).values({ lockKey }).onDuplicateKeyUpdate({ set: { lockKey } })
      await tx.select().from(dbLock).where(eq(dbLock.lockKey, lockKey)).for('update')
      const [locked] = await tx.select().from(serviceRequest).where(eq(serviceRequest.id, srId)).for('update')
      if (locked?.status !== 'draft') throw new ConflictException('이미 접수되었습니다')
      const [max] = await tx.select({ value: sql<number>`coalesce(max(cast(substring(${serviceRequest.code}, 9) as unsigned)), 0)` }).from(serviceRequest).where(sql`${serviceRequest.code} like ${`SR-${year}-%`}`)
      const code = `SR-${year}-${String(Number(max?.value ?? 0) + 1).padStart(4, '0')}`
      await tx.update(serviceRequest).set({ code, title: input.title.trim(), titleSource: input.titleSource ?? 'manual', body: input.body, status: 'submitted', submittedAt: new Date(), updatedAt: new Date() }).where(eq(serviceRequest.id, srId))
      await tx.insert(activityLog).values({ id: id(), type: 'sr.status_changed', userId: actor, srId, payload: { from: 'draft', to: 'submitted' } })
      await this.saveContentAttachments(tx, srId, input.body, attachmentIds)
      await tx.insert(tag).values({ key: code.toLowerCase(), label: code, kind: 'sr' }).onDuplicateKeyUpdate({ set: { key: code.toLowerCase() } })
    })
    const [setting] = await this.db.select().from(appSetting).where(eq(appSetting.key, 'srIntakeAssistantId'))
    if (typeof setting?.value === 'string') {
      const [intake] = await this.db.select().from(assistant).where(eq(assistant.id, setting.value))
      if (intake) await this.notifications.send([intake.ownerId], actor, 'SR이 접수되었습니다', `${(await this.row(srId)).code} ${input.title.trim()}`, '/sr/manage')
    }
    return this.get(actor, srId)
  }
  async title(actor: string, srId: string, title: string) {
    if (!title.trim()) throw new BadRequestException('제목을 입력하세요')
    const row = await this.view(actor, srId), user = await this.user(actor)
    if (row.requesterId !== actor && !user.isSystemOwner) throw new ForbiddenException('요청자 또는 SO만 수정할 수 있습니다')
    await this.db.update(serviceRequest).set({ title: title.trim(), titleSource: 'manual', updatedAt: new Date() }).where(eq(serviceRequest.id, srId))
    return this.get(actor, srId)
  }
  async content(actor: string, srId: string, input: { title: string; body: string; attachmentIds: string[]; titleSource?: 'ai' | 'manual' }) {
    if (!input.title.trim()) throw new BadRequestException('제목을 입력하세요')
    const row = await this.view(actor, srId), user = await this.user(actor)
    if (row.requesterId !== actor && !user.isSystemOwner) throw new ForbiddenException('요청자 또는 SO만 수정할 수 있습니다')
    if (row.status !== 'draft' && row.status !== 'submitted') throw new ConflictException('검토 전 내용만 수정할 수 있습니다')
    const attachmentIds = [...new Set(input.attachmentIds)]
    if (attachmentIds.length) {
      const valid = await this.db.select({ id: fileObject.id }).from(fileObject).where(and(inArray(fileObject.id, attachmentIds), eq(fileObject.originSrId, srId), isNull(fileObject.deletedAt)))
      if (valid.length !== attachmentIds.length) throw new BadRequestException('이 SR의 첨부만 선택할 수 있습니다')
    }
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(serviceRequest).where(eq(serviceRequest.id, srId)).for('update')
      if (locked?.status !== 'draft' && locked?.status !== 'submitted') throw new ConflictException('검토 전 내용만 수정할 수 있습니다')
      await tx.update(serviceRequest).set({ title: input.title.trim(), body: input.body,
        titleSource: locked.titleSource === 'manual' || input.title.trim() !== locked.title ? 'manual' : input.titleSource ?? locked.titleSource,
        updatedAt: new Date() }).where(eq(serviceRequest.id, srId))
      await this.saveContentAttachments(tx, srId, input.body, attachmentIds)
    })
    return this.get(actor, srId)
  }
  async status(actor: string, srId: string, status: SrStatus) {
    await this.manager(actor, srId)
    const changed = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(serviceRequest).where(eq(serviceRequest.id, srId)).for('update')
      if (!row) throw new NotFoundException('SR을 찾을 수 없습니다')
      if (row.status === 'draft') throw new ConflictException('접수된 SR만 변경할 수 있습니다')
      if (row.status === status) return null
      await tx.update(serviceRequest).set({ status, updatedAt: new Date() }).where(eq(serviceRequest.id, srId))
      await tx.insert(activityLog).values({ id: id(), type: 'sr.status_changed', userId: actor, srId, payload: { from: row.status, to: status } })
      return row
    })
    if (changed) await this.notifications.send([changed.requesterId], actor, `SR 상태가 변경되었습니다: ${status}`, `${changed.code} ${changed.title}`, '/sr')
    return this.get(actor, srId)
  }
  async delete(actor: string, srId: string) {
    const row = await this.view(actor, srId)
    if (row.requesterId !== actor) throw new ForbiddenException('요청자만 삭제할 수 있습니다')
    if (row.status !== 'draft') throw new ConflictException('초안만 삭제할 수 있습니다')
    const keys = await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(serviceRequest).where(eq(serviceRequest.id, srId)).for('update')
      if (locked?.status !== 'draft') throw new ConflictException('초안만 삭제할 수 있습니다')
      const [srThread] = await tx.select().from(thread).where(eq(thread.srId, srId))
      if (srThread) {
        const requests = await tx.select().from(chatRequest).where(eq(chatRequest.threadId, srThread.id))
        if (requests.length) throw new ConflictException('요청 기록이 있는 초안은 삭제할 수 없습니다')
        const messages = await tx.select({ id: message.id }).from(message).where(eq(message.threadId, srThread.id))
        if (messages.length) await tx.delete(messageAttachment).where(inArray(messageAttachment.messageId, messages.map((item) => item.id)))
        await tx.delete(message).where(eq(message.threadId, srThread.id))
        await tx.delete(thread).where(eq(thread.id, srThread.id))
      }
      const files = await tx.select().from(fileObject).where(eq(fileObject.originSrId, srId)).orderBy(desc(fileObject.version))
      for (const file of files) await tx.delete(fileObject).where(eq(fileObject.id, file.id))
      await tx.delete(activityLog).where(eq(activityLog.srId, srId))
      await tx.delete(serviceRequest).where(eq(serviceRequest.id, srId))
      return files.map((file) => file.storageKey)
    })
    if (this.config) {
      const storage = new FileStorageService(this.config.fileStorageRoot)
      for (const key of keys) await storage.remove(key).catch(() => undefined)
    }
  }
  async startTask(actor: string, srId: string, input: { assistantId: string; forceNew?: boolean }) {
    await this.starter(actor, srId)
    const row = await this.row(srId)
    if (row.status === 'draft' || !row.code) throw new ConflictException('접수된 SR에서만 시작할 수 있습니다')
    const candidates = (await this.get(actor, srId)).conversations.filter((item) => item.status === 'in_progress')
    if (candidates.length && !input.forceNew) return { candidates }
    const created = await this.tasks.create(actor, { assistantId: input.assistantId, tags: [row.code], title: row.title }, undefined, srId)
    if (row.status === 'submitted' || row.status === 'reviewing') await this.status(actor, srId, 'in_progress')
    return created.task
  }
  async share(actor: string, srId: string, input: { taskId?: string; text?: string; fileIds?: string[] }) {
    await this.manager(actor, srId)
    const row = await this.row(srId)
    if (row.status === 'draft') throw new ConflictException('접수되지 않은 SR입니다')
    const text = input.text?.trim() ?? '', fileIds = [...new Set(input.fileIds ?? [])]
    if (!text && !fileIds.length) throw new BadRequestException('공유할 내용이나 파일을 입력하세요')
    if (input.taskId) {
      const linked = (await this.get(actor, srId)).conversations.some((item) => item.id === input.taskId)
      if (!linked) throw new BadRequestException('연결되지 않은 대화입니다')
    }
    if (fileIds.length) {
      const valid = await this.db.select().from(fileObject).where(and(inArray(fileObject.id, fileIds), isNull(fileObject.deletedAt), eq(fileObject.isOutput, true)))
      if (valid.length !== fileIds.length || valid.some((item) => !input.taskId || item.originTaskId !== input.taskId)) throw new BadRequestException('연결 대화의 산출물만 공유할 수 있습니다')
    }
    const resultId = id()
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(serviceRequest).where(eq(serviceRequest.id, srId)).for('update')
      if (!locked || locked.status === 'draft') throw new ConflictException('접수되지 않은 SR입니다')
      await tx.insert(sharedResult).values({ id: resultId, srId, taskId: input.taskId, text, byUser: actor })
      if (fileIds.length) await tx.insert(sharedResultFile).values(fileIds.map((fileId) => ({ resultId, fileId })))
      const nextStatus = locked.status === 'done' || locked.status === 'rejected' ? locked.status : 'responded'
      await tx.update(serviceRequest).set({ status: nextStatus, updatedAt: new Date() }).where(eq(serviceRequest.id, srId))
      if (locked.status !== nextStatus) await tx.insert(activityLog).values({ id: id(), type: 'sr.status_changed', userId: actor, srId, payload: { from: locked.status, to: nextStatus } })
    })
    await this.notifications.send([row.requesterId], actor, '요청 결과가 공유되었습니다', `${row.code} ${row.title}`, '/sr')
    return (await this.results(actor, srId)).find((item) => item.id === resultId)!
  }
  async results(actor: string, srId: string) { return (await this.get(actor, srId)).results }
}
