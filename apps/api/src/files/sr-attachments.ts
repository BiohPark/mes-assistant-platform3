import { ForbiddenException } from '@nestjs/common'
import { and, eq, exists, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Db } from '../db/db.module.js'
import { fileObject, serviceRequest, task, taskAssignee, taskTag } from '../db/schema.js'
import { assertFileAccess } from '../sr/access.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** 접수 대화에 올린 파일 전체를 같은 SR 자료함으로 공유한다. 삭제된 파일은 제외한다. */
export async function srAttachments(db: Db | Tx, srId: string) {
  return db.select().from(fileObject)
    .where(and(eq(fileObject.originSrId, srId), inArray(fileObject.kind, ['sr_attachment', 'ai_output']), isNull(fileObject.deletedAt)))
    .orderBy(fileObject.uploadedAt, fileObject.id)
}

/** 시작한 SR과 SR 번호 태그 연결의 합집합. 태그 키는 라벨 표기와 무관하게 정규화되어 있다. */
function linkedSr(db: Db | Tx) {
  return or(eq(task.srId, serviceRequest.id), exists(db.select({ taskId: taskTag.taskId }).from(taskTag)
    .where(and(eq(taskTag.taskId, task.id), eq(taskTag.tagKey, sql`lower(${serviceRequest.code})`)))))
}

/** 연결 업무의 자료함 후보와 선택 검사가 같은 연결 규칙을 쓴다. */
export async function taskSrAttachments(db: Db | Tx, taskId: string) {
  return db.select({ file: fileObject, srId: serviceRequest.id, srCode: serviceRequest.code, srTitle: serviceRequest.title }).from(task)
    .innerJoin(serviceRequest, linkedSr(db))
    .innerJoin(fileObject, eq(fileObject.originSrId, serviceRequest.id))
    .where(and(eq(task.id, taskId), isNull(task.deletedAt), inArray(fileObject.kind, ['sr_attachment', 'ai_output']), isNull(fileObject.deletedAt)))
    .orderBy(serviceRequest.code, serviceRequest.id, fileObject.uploadedAt, fileObject.id)
}

/** 연결 업무 참여자(만든 사람·소유자·담당자 — assertTaskAccess와 같은 범위)면 그 SR에 올린 파일을 읽을 수 있다. */
async function linkedParticipant(db: Db, actor: string, fileId: string) {
  const [file] = await db.select({ srId: fileObject.originSrId }).from(fileObject)
    .where(and(eq(fileObject.id, fileId), inArray(fileObject.kind, ['sr_attachment', 'ai_output']), isNull(fileObject.deletedAt)))
  if (!file?.srId) return false
  const linked = await db.select({ id: task.id, createdBy: task.createdBy, ownerId: task.ownerId }).from(task)
    .innerJoin(serviceRequest, and(eq(serviceRequest.id, file.srId), linkedSr(db)))
    .where(isNull(task.deletedAt))
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
