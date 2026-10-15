import { ForbiddenException } from '@nestjs/common'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Db } from '../db/db.module.js'
import { fileObject, task, taskAssignee } from '../db/schema.js'
import { assertFileAccess } from '../sr/access.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** 접수 대화에 올린 파일 전체를 같은 SR 자료함으로 공유한다. 삭제된 파일은 제외한다. */
export async function srAttachments(db: Db | Tx, srId: string) {
  return db.select().from(fileObject)
    .where(and(eq(fileObject.originSrId, srId), eq(fileObject.kind, 'sr_attachment'), isNull(fileObject.deletedAt)))
    .orderBy(fileObject.uploadedAt, fileObject.id)
}

/** 연결 업무(task.srId) 참여자(만든 사람·소유자·담당자 — assertTaskAccess와 같은 범위)면 그 SR에 올린 파일을 읽을 수 있다. */
async function linkedParticipant(db: Db, actor: string, fileId: string) {
  const [file] = await db.select({ srId: fileObject.originSrId }).from(fileObject)
    .where(and(eq(fileObject.id, fileId), eq(fileObject.kind, 'sr_attachment'), isNull(fileObject.deletedAt)))
  if (!file?.srId) return false
  if (!(await srAttachments(db, file.srId)).some((row) => row.id === fileId)) return false
  const linked = await db.select({ id: task.id, createdBy: task.createdBy, ownerId: task.ownerId }).from(task)
    .where(and(eq(task.srId, file.srId), isNull(task.deletedAt)))
  if (linked.some((row) => row.createdBy === actor || row.ownerId === actor)) return true
  if (!linked.length) return false
  const [assigned] = await db.select({ taskId: taskAssignee.taskId }).from(taskAssignee)
    .where(and(inArray(taskAssignee.taskId, linked.map((row) => row.id)), eq(taskAssignee.userId, actor))).limit(1)
  return !!assigned
}

/** 파일 읽기 권한 — 기존 규칙(assertFileAccess)에 '연결 업무 참여자 → 연결 SR 파일'만 더한다. */
export async function assertFileReadable(db: Db, actor: string, fileId: string) {
  try { await assertFileAccess(db, actor, fileId) }
  catch (error) {
    if (error instanceof ForbiddenException && await linkedParticipant(db, actor, fileId)) return
    throw error
  }
}
