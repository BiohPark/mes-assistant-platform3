import { ForbiddenException } from '@nestjs/common'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Db } from '../db/db.module.js'
import { fileObject, message, messageAttachment, task, taskAssignee, thread } from '../db/schema.js'
import { assertFileAccess } from '../sr/access.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * 접수 첨부 정본 = 접수 본문 메시지(authorId null)의 첨부 — sr.service assemble의 attachmentIds와 같은 기준.
 * 채팅으로 올렸을 뿐인 후보 파일은 넣지 않는다.
 */
export async function srAttachments(db: Db | Tx, srId: string) {
  const rows = await db.select({ file: fileObject }).from(messageAttachment)
    .innerJoin(message, eq(messageAttachment.messageId, message.id)).innerJoin(thread, eq(message.threadId, thread.id))
    .innerJoin(fileObject, eq(messageAttachment.fileId, fileObject.id))
    .where(and(eq(thread.srId, srId), eq(message.role, 'user'), eq(message.kind, 'discussion'), isNull(message.authorId),
      eq(fileObject.originSrId, srId), isNull(fileObject.deletedAt)))
    .orderBy(fileObject.uploadedAt, fileObject.id)
  return [...new Map(rows.map((row) => [row.file.id, row.file])).values()]
}

/** 연결 업무(task.srId) 참여자(만든 사람·소유자·담당자 — assertTaskAccess와 같은 범위)면 그 SR의 접수 첨부 정본을 읽을 수 있다. */
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

/** 파일 읽기 권한 — 기존 규칙(assertFileAccess)에 '연결 업무 참여자 → 연결 SR 첨부 정본'만 더한다. */
export async function assertFileReadable(db: Db, actor: string, fileId: string) {
  try { await assertFileAccess(db, actor, fileId) }
  catch (error) {
    if (error instanceof ForbiddenException && await linkedParticipant(db, actor, fileId)) return
    throw error
  }
}
