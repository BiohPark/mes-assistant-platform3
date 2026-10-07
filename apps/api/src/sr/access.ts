import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { and, eq, isNull, inArray } from 'drizzle-orm'
import type { Db } from '../db/db.module.js'
import { appUser, fileObject, serviceRequest, sharedResult, sharedResultFile, task, taskAssignee, thread } from '../db/schema.js'

export async function assertSrAccess(db: Db, actor: string, srId: string) {
  const [sr] = await db.select().from(serviceRequest).where(eq(serviceRequest.id, srId))
  if (!sr) throw new NotFoundException('SR을 찾을 수 없습니다')
  if (sr.requesterId === actor) return sr
  const [user] = await db.select().from(appUser).where(eq(appUser.id, actor))
  if (user?.isSystemOwner) return sr
  if (user?.isBusinessOwner) throw new ForbiddenException('자신의 SR만 볼 수 있습니다')
  const related = await db.select({ id: task.id, ownerId: task.ownerId }).from(task)
    .where(and(eq(task.srId, srId), isNull(task.deletedAt)))
  if (related.some((item) => item.ownerId === actor)) return sr
  if (related.length) {
    const assignees = await db.select({ userId: taskAssignee.userId }).from(taskAssignee).where(inArray(taskAssignee.taskId, related.map((item) => item.id)))
    if (assignees.some((item) => item.userId === actor)) return sr
  }
  throw new ForbiddenException('접수 대화에 접근할 수 없습니다')
}

export async function assertThreadAccess(db: Db, actor: string, threadId: string) {
  const [owner] = await db.select({ srId: thread.srId, taskId: thread.taskId }).from(thread).where(eq(thread.id, threadId))
  if (!owner) throw new NotFoundException('스레드를 찾을 수 없습니다')
  if (!owner.srId) {
    const [user] = await db.select({ isBusinessOwner: appUser.isBusinessOwner, isSystemOwner: appUser.isSystemOwner }).from(appUser).where(eq(appUser.id, actor))
    if (user?.isBusinessOwner && !user.isSystemOwner) throw new ForbiddenException('접수 대화만 볼 수 있습니다')
  }
  if (owner.srId) await assertSrAccess(db, actor, owner.srId)
  if (owner.taskId) await assertTaskAccess(db, actor, owner.taskId)
}

export async function assertTaskAccess(db: Db, actor: string, taskId: string) {
  const [user] = await db.select().from(appUser).where(eq(appUser.id, actor))
  if (!user?.isBusinessOwner || user.isSystemOwner) return
  const [row] = await db.select({ createdBy: task.createdBy, ownerId: task.ownerId }).from(task).where(and(eq(task.id, taskId), isNull(task.deletedAt)))
  if (!row) throw new NotFoundException('대화를 찾을 수 없습니다')
  if (row.createdBy === actor || row.ownerId === actor) return
  const [assigned] = await db.select().from(taskAssignee).where(and(eq(taskAssignee.taskId, taskId), eq(taskAssignee.userId, actor)))
  if (!assigned) throw new ForbiddenException('내부 대화에 접근할 수 없습니다')
}

export async function assertFileAccess(db: Db, actor: string, fileId: string) {
  const [user] = await db.select().from(appUser).where(eq(appUser.id, actor))
  if (!user?.isBusinessOwner || user.isSystemOwner) return
  const [file] = await db.select().from(fileObject).where(and(eq(fileObject.id, fileId), isNull(fileObject.deletedAt)))
  if (!file) throw new NotFoundException('파일을 찾을 수 없습니다')
  if (file.originSrId) {
    const [sr] = await db.select({ requesterId: serviceRequest.requesterId }).from(serviceRequest).where(eq(serviceRequest.id, file.originSrId))
    if (sr?.requesterId === actor && file.uploadedBy === actor) return
  }
  const shared = await db.select({ requesterId: serviceRequest.requesterId }).from(sharedResultFile)
    .innerJoin(sharedResult, eq(sharedResultFile.resultId, sharedResult.id))
    .innerJoin(serviceRequest, eq(sharedResult.srId, serviceRequest.id))
    .where(eq(sharedResultFile.fileId, fileId))
  if (shared.some((item) => item.requesterId === actor)) return
  throw new ForbiddenException('공유되지 않은 파일입니다')
}
