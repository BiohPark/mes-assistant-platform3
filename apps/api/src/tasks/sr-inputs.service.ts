import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { isSrTag, normalizeTag } from '@mes/domain'
import type { TaskSrInput } from '@mes/contracts'
import { DB, type Db } from '../db/db.module.js'
import { appUser, chatRequest, chatRequestInput, serviceRequest, srInput, tag, task, taskTag, thread } from '../db/schema.js'
import { assertTaskAccess } from '../sr/access.js'
import { EventsService } from '../events/events.service.js'

/** 태그와 직접 sr_id 연결의 합집합. SR 접근 권한은 모든 읽기·담기·전송에 동일하게 적용한다. */
export async function linkedTaskSrs(db: Db, actor: string, taskId: string) {
  await assertTaskAccess(db, actor, taskId)
  const [owner] = await db.select().from(task).where(and(eq(task.id, taskId), isNull(task.deletedAt)))
  if (!owner) throw new NotFoundException('대화를 찾을 수 없습니다')
  const tags = await db.select({ label: tag.label }).from(taskTag).innerJoin(tag, eq(tag.key, taskTag.tagKey)).where(eq(taskTag.taskId, taskId))
  const codes = [...new Set(tags.map(row => normalizeTag(row.label)).filter(isSrTag))]
  if (!codes.length && !owner.srId) return []
  const rows = await db.select().from(serviceRequest).where(or(...(codes.length ? [inArray(serviceRequest.code, codes)] : []), ...(owner.srId ? [eq(serviceRequest.id, owner.srId)] : []))).orderBy(serviceRequest.code, serviceRequest.id)
  // SR 상세(SrService.view)와 같은 범위: 내부 사용자·SO 전체, BO는 본인 접수만.
  const [viewer] = await db.select().from(appUser).where(eq(appUser.id, actor))
  if (!viewer) throw new ForbiddenException('사용자를 찾을 수 없습니다')
  return viewer.isBusinessOwner && !viewer.isSystemOwner ? rows.filter(row => row.requesterId === actor) : rows
}

@Injectable()
export class SrInputsService {
  constructor(@Inject(DB) private readonly db: Db, @Inject(EventsService) private readonly events: EventsService) {}

  async list(actor: string, taskId: string): Promise<TaskSrInput[]> {
    const linked = await linkedTaskSrs(this.db, actor, taskId)
    const selected = await this.db.select().from(srInput).where(eq(srInput.taskId, taskId))
    const used = await this.db.select({ srId: chatRequestInput.srId }).from(chatRequestInput)
      .innerJoin(chatRequest, eq(chatRequest.id, chatRequestInput.requestId)).innerJoin(thread, eq(thread.id, chatRequest.threadId))
      .where(and(eq(thread.taskId, taskId), eq(chatRequestInput.kind, 'sr')))
    return linked.map(sr => ({ srId: sr.id, code: sr.code ?? '', title: sr.title, body: sr.body,
      bytes: Buffer.byteLength(sr.body), selected: selected.some(row => row.srId === sr.id), used: used.some(row => row.srId === sr.id) }))
  }

  private async change(actor: string, taskId: string, srId: string, selected: boolean) {
    await assertTaskAccess(this.db, actor, taskId)
    await this.db.transaction(async tx => {
      const [owner] = await tx.select().from(task).where(and(eq(task.id, taskId), isNull(task.deletedAt))).for('update')
      if (!owner) throw new NotFoundException('대화를 찾을 수 없습니다')
      if (owner.status === 'done') throw new ConflictException({ code: 'TASK_DONE' })
      if (selected) {
        const linked = await linkedTaskSrs(tx as Db, actor, taskId)
        if (!linked.some(sr => sr.id === srId)) throw new NotFoundException('접근 가능한 연결 SR이 아닙니다')
        await tx.insert(srInput).values({ taskId, srId }).onDuplicateKeyUpdate({ set: { srId } })
      } else await tx.delete(srInput).where(and(eq(srInput.taskId, taskId), eq(srInput.srId, srId)))
    })
    this.events.publish('input.updated', { taskId })
  }
  async select(actor: string, taskId: string, srId: string) { await this.change(actor, taskId, srId, true) }
  async remove(actor: string, taskId: string, srId: string) { await this.change(actor, taskId, srId, false) }
}
