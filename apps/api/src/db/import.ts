import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { drizzle } from 'drizzle-orm/mysql2'
import { eq, sql } from 'drizzle-orm'
import type { Db } from './db.module.js'
import { createPool } from './connection.js'
import { hashPassword } from '../auth/password.js'
import { FileStorageService, createStorageKey, sha256 } from '../files/fileStorage.service.js'
import { validName } from '../files/files.service.js'
import * as s from './schema.js'

type Row = Record<string, any>
type Tables = Record<string, Row[] | undefined>
export type Bundle = { format: 'mes-assistant-hub'; version: 1 | 2 | 3; exportedAt?: string; tables: Tables }
const legacyCatalogOrder = new Map([
  'deviation-drafter', 'cc-writer', 'cc-item-builder', 'release-cca-writer', 'urs-analyst-basic', 'urs-analyst',
  'fds-writer', 'fds-reviewer', 'test-scenario-writer', 'deploy-verifier', 'cca-writer', 'protocol-reviewer',
].map((id, index) => [id, index + 1]))

export function validateBundle(input: unknown): input is Bundle {
  if (!input || typeof input !== 'object') return false
  const b = input as Partial<Bundle>
  return b.format === 'mes-assistant-hub' && [1, 2, 3].includes(b.version ?? 0) &&
    !!b.tables && typeof b.tables === 'object' && !Array.isArray(b.tables) &&
    Object.values(b.tables).every(Array.isArray)
}

/** 데모 exportImport.ts + migrations/v3.ts의 v1 백업 변환 규칙. */
export function normalizeBundle(input: unknown): Bundle {
  if (!validateBundle(input)) throw new Error('지원하지 않는 파일 형식입니다.')
  if (input.version !== 1) return input
  const tables = { ...input.tables }
  const tasks = tables.tasks ?? []
  const threads = (tables.threads ?? []).map((t) => ({ ...t }))
  const srs = tables.serviceRequests ?? []
  const srCodes = new Map(srs.map((sr) => [sr.id, sr.code]))
  tables.tasks = tasks.flatMap((t) => {
    const own = threads.filter((th) => th.taskId === t.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    const primary = t.threadId ?? t.activeThreadId ?? own[0]?.id
    const base: Row = { ...t, titleSource: t.titleSource ?? 'manual',
      tags: [...new Set([...(t.tags ?? []), ...(t.srIds ?? []).map((id: string) => srCodes.get(id)).filter(Boolean)])],
      inputs: t.inputs ?? (t.inputFileIds ?? []).map((fileId: string) => ({ fileId, weight: 'reference', selectedAt: t.createdAt, selectedBy: t.createdBy })),
      threadId: primary, lastActivityAt: t.lastActivityAt ?? t.completedAt ?? t.startedAt ?? t.createdAt }
    const splits = own.filter((th) => th.id !== primary).map((th, i) => {
      const id = `${t.id}_split${i + 1}`
      th.taskId = id
      const itemIds = new Map((base.checklist ?? []).map((item: Row) => [String(item.id), `${id}:${String(item.id)}`]))
      return { ...base, id, code: `${t.code}-${i + 2}`, title: `${t.title} · ${th.title}`, inputs: [], outputFileIds: [], threadId: th.id, createdAt: th.createdAt, lastActivityAt: th.createdAt,
        checklist: (base.checklist ?? []).map((item: Row) => ({ ...item, id: itemIds.get(String(item.id)) })),
        checklistReview: base.checklistReview && { ...base.checklistReview, items: (base.checklistReview.items ?? []).map((item: Row) => ({ ...item, itemId: itemIds.get(String(item.itemId)) ?? item.itemId })) } }
    })
    return [base, ...splits]
  })
  tables.threads = threads
  let legacyOrder = 1000
  tables.assistants = (tables.assistants ?? []).map((a) => ({ ...a, status: a.status === 'working' ? 'developing' : a.status,
    level1: a.level1 ?? '이전 데모', order: a.order ?? legacyCatalogOrder.get(a.id) ?? legacyOrder++, expectedInputs: a.expectedInputs ?? [], expectedOutputs: a.expectedOutputs ?? [] }))
  tables.serviceRequests = srs.map((sr) => ({ ...sr, titleSource: sr.titleSource ?? (sr.title ? 'manual' : 'default') }))
  return { ...input, tables }
}

/** 로그인 ID는 데모 ID에서 유도하되, 한글 등은 UTF-8 hex로 안정적으로 치환한다. */
export function loginIdFor(id: string, _name: string, used: Set<string>): string {
  const slug = id.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  const base = `demo-${slug || Buffer.from(id).toString('hex').slice(0, 20)}`.slice(0, 29)
  let candidate = base
  for (let suffix = 2; used.has(candidate); suffix++) candidate = `${base.slice(0, 32 - String(suffix).length - 1)}-${suffix}`
  used.add(candidate)
  return candidate
}

const date = (value: unknown) => value ? new Date(String(value)) : undefined
const rows = (b: Bundle, key: string) => b.tables[key] ?? []
const id = (value: unknown) => String(value)
const present = (value: unknown) => value !== undefined && value !== null && value !== ''
const keyOf = (source: string, target: string) => `${source} → ${target}`
export type ImportReport = Record<string, { imported: number; skipped: number; reason?: string }>
const same = (actual: Row, expected: Row) => Object.entries(expected).every(([key, value]) => value === undefined ||
  (value instanceof Date ? new Date(actual[key]).getTime() === value.getTime() :
    typeof value === 'object' && value !== null ? JSON.stringify(actual[key]) === JSON.stringify(value) : (actual[key] ?? null) === (value ?? null)))

export async function importBundle(input: unknown, db: Db, storage: FileStorageService | undefined, dryRun = false): Promise<{ report: ImportReport; credentials: { loginId: string; password: string }[] }> {
  const b = normalizeBundle(input)
  const report: ImportReport = {}
  const credentials: { loginId: string; password: string }[] = []
  const written: string[] = []
  const conflicts: string[] = []
  const known = new WeakMap<object, Set<string>>()
  const mark = (source: string, target: string, imported: boolean, reason?: string) => {
    const key = keyOf(source, target)
    const item = report[key] ??= { imported: 0, skipped: 0 }
    if (imported) item.imported++
    else { item.skipped++; item.reason = reason ?? '이미 존재' }
  }
  const skip = (source: string, target: string, reason: string) => { for (const _ of rows(b, source)) mark(source, target, false, reason) }
  const children = (source: string, target: string, items: Row[], parentKey: string, parentSource: string, created: Set<string>) => {
    const parents = new Set(rows(b, parentSource).map((row) => id(row.id)))
    return items.filter((row) => {
      const parentId = id(row[parentKey])
      if (!parents.has(parentId)) throw new Error(`${source}:${row.id} — ${parentSource}:${parentId} 상위 행 없음`)
      if (created.has(parentId)) return true
      mark(source, target, false, '상위 행 건너뜀')
      return false
    })
  }
  const existing = async (tx: Db, table: any, column: any): Promise<Set<string>> => {
    const cached = known.get(table)
    if (cached) return cached
    const found = await tx.select({ id: column }).from(table)
    const ids = new Set(found.map((row) => String(row.id)))
    known.set(table, ids)
    return ids
  }
  const insert = async (tx: Db, source: string, target: string, table: any, primary: any, items: Row[], convert: (row: Row, index: number) => Row,
    allow?: (row: Row) => boolean) => {
    const seen = await existing(tx, table, primary)
    const created = new Set<string>()
    for (const [i, row] of items.entries()) {
      const value = convert(row, i)
      const rowId = id(value.id ?? value.key ?? value.taskId)
      if (seen.has(rowId)) {
        const [old] = await tx.select().from(table).where(eq(primary, rowId))
        if (created.has(rowId) || !old || !same(old, value)) conflicts.push(`${target}:${rowId}`)
        mark(source, target, false); continue
      }
      if (allow && !allow(row)) { mark(source, target, false, '상위 행 건너뜀'); continue }
      await tx.insert(table).values(value)
      seen.add(rowId)
      created.add(rowId)
      mark(source, target, true)
    }
    return created
  }
  try {
    await db.transaction(async (tx) => {
      // 한 이관 실행만 같은 DB에서 진행하도록 트랜잭션 범위 이름 잠금.
      await tx.execute(sql`insert into db_lock (lock_key) values ('demo-import') on duplicate key update lock_key = lock_key`)
      const usedLogins = new Set((await tx.select({ loginId: s.appUser.loginId }).from(s.appUser)).map((x) => x.loginId).filter((x): x is string => !!x))
      const users = await existing(tx, s.appUser, s.appUser.id)
      for (const row of rows(b, 'users')) {
        if (users.has(id(row.id))) {
          const [old] = await tx.select().from(s.appUser).where(eq(s.appUser.id, id(row.id)))
          if (!old || !same(old, { name: String(row.name ?? row.id), role: String(row.role ?? ''), initials: String(row.initials ?? '').slice(0, 8), color: String(row.color ?? '#64748b'),
            isSystemOwner: !!row.isSystemOwner, isBusinessOwner: !!row.isBusinessOwner || /requester|요청자/i.test(String(row.role ?? '')) })) conflicts.push(`app_user:${row.id}`)
          mark('users', 'app_user', false); continue
        }
        const loginId = loginIdFor(id(row.id), String(row.name ?? ''), usedLogins)
        const password = randomBytes(24).toString('base64url')
        {
          await tx.insert(s.appUser).values({ id: id(row.id), loginId, passwordHash: await hashPassword(password), mustChangePassword: true,
            name: String(row.name ?? row.id), role: String(row.role ?? ''), initials: String(row.initials ?? '').slice(0, 8), color: String(row.color ?? '#64748b'),
            isSystemOwner: !!row.isSystemOwner, isBusinessOwner: !!row.isBusinessOwner || /requester|요청자/i.test(String(row.role ?? '')) })
          if (!dryRun) credentials.push({ loginId, password })
        }
        users.add(id(row.id)); mark('users', 'app_user', true)
      }
      const level1 = [...new Set(rows(b, 'assistants').map((a) => String(a.level1 ?? '이전 데모')))]
      const level2 = [...new Set(rows(b, 'assistants').map((a) => String(a.level2 ?? '기타')))]
      for (const [group, names] of [['assistant_level1', level1], ['assistant_level2', level2]] as const) {
        if (!names.length) continue
        const [old] = await tx.select().from(s.codeGroup).where(eq(s.codeGroup.key, group))
        if (!old) await tx.insert(s.codeGroup).values({ key: group, name: group === 'assistant_level1' ? '업무 Lv1' : '업무 Lv2' })
        mark('assistants.levels', 'code_group', !old)
        for (const [i, name] of names.entries()) {
          const codeId = `${group}:${name}`
          const [oldCode] = await tx.select().from(s.code).where(eq(s.code.id, codeId))
          if (!oldCode) await tx.insert(s.code).values({ id: codeId, groupKey: group, code: name, name, sortOrder: i })
          mark('assistants.levels', 'code', !oldCode)
        }
      }
      const newAssistants = await insert(tx, 'assistants', 'assistant', s.assistant, s.assistant.id, rows(b, 'assistants'), (a, i) => ({
        id: id(a.id), name: String(a.name), level1CodeId: `assistant_level1:${a.level1 ?? '이전 데모'}`, level2CodeId: `assistant_level2:${a.level2 ?? '기타'}`,
        summary: String(a.summary ?? ''), sortOrder: a.order ?? i, modelId: a.modelId, link1: a.link1, docUrl: a.docUrl,
        ownerId: id(a.ownerId), status: a.status === 'working' ? 'developing' : a.status, usageExample: String(a.usageExample ?? ''),
        color: String(a.color ?? '#64748b'), createdBy: id(a.createdBy ?? a.ownerId), createdAt: date(a.createdAt), updatedAt: date(a.updatedAt),
      }))
      for (const a of rows(b, 'assistants')) {
        if (!newAssistants.has(id(a.id))) {
          for (const _ of [...(a.expectedInputs ?? []), ...(a.expectedOutputs ?? [])]) mark('assistants.expectedIo', 'assistant_expected_io', false, '상위 행 건너뜀')
          for (const _ of a.checklistTemplate ?? []) mark('assistants.checklistTemplate', 'assistant_checklist_template', false, '상위 행 건너뜀')
          continue
        }
        for (const [direction, labels] of [['input', a.expectedInputs ?? []], ['output', a.expectedOutputs ?? []]] as const) {
          for (const [sortOrder, label] of labels.entries()) {
            const [old] = await tx.select().from(s.assistantExpectedIo).where(sql`${s.assistantExpectedIo.assistantId} = ${a.id} and ${s.assistantExpectedIo.direction} = ${direction} and ${s.assistantExpectedIo.sortOrder} = ${sortOrder}`)
            if (!old) await tx.insert(s.assistantExpectedIo).values({ assistantId: id(a.id), direction, sortOrder, label: String(label) })
            mark('assistants.expectedIo', 'assistant_expected_io', !old)
          }
        }
        await insert(tx, 'assistants.checklistTemplate', 'assistant_checklist_template', s.assistantChecklistTemplate, s.assistantChecklistTemplate.id,
          a.checklistTemplate ?? [], (item: Row, i: number) => ({ id: id(item.id), assistantId: id(a.id), sortOrder: i, label: String(item.label), required: !!item.required }))
      }
      const newSrs = await insert(tx, 'serviceRequests', 'service_request', s.serviceRequest, s.serviceRequest.id, rows(b, 'serviceRequests'), (sr) => ({
        id: id(sr.id), code: sr.code || null, requesterId: id(sr.requesterId), title: String(sr.title ?? ''), titleSource: sr.titleSource ?? (sr.title ? 'manual' : 'default'),
        body: String(sr.body ?? ''), status: sr.status ?? 'draft', submittedAt: date(sr.submittedAt), createdAt: date(sr.createdAt), updatedAt: date(sr.updatedAt),
      }))
      const srByCode = new Map(rows(b, 'serviceRequests').map((sr) => [sr.code, sr.id]))
      const newTasks = await insert(tx, 'tasks', 'task', s.task, s.task.id, rows(b, 'tasks'), (t) => ({
        id: id(t.id), code: String(t.code), assistantId: id(t.assistantId), srId: (t.tags ?? []).map((tag: string) => srByCode.get(tag)).find(Boolean), title: String(t.title), titleSource: t.titleSource ?? 'manual',
        summary: String(t.summary ?? ''), status: t.status ?? 'todo', ownerId: id(t.ownerId), priority: t.priority ?? 'normal',
        dueDate: typeof t.dueDate === 'string' ? t.dueDate.slice(0, 10) : undefined, modelId: t.modelId,
        createdBy: id(t.createdBy), createdAt: date(t.createdAt), lastActivityAt: date(t.lastActivityAt ?? t.createdAt),
        startedAt: date(t.startedAt), completedAt: date(t.completedAt), completedBy: t.completedBy,
      }))
      for (const th of rows(b, 'threads')) if (!!th.taskId === !!th.srId) throw new Error(`threads:${th.id} — taskId 또는 srId 하나가 필요합니다`)
      const taskThreads = children('threads', 'thread', rows(b, 'threads').filter((th) => th.taskId), 'taskId', 'tasks', newTasks)
      const srThreads = children('threads', 'thread', rows(b, 'threads').filter((th) => th.srId), 'srId', 'serviceRequests', newSrs)
      const newThreads = await insert(tx, 'threads', 'thread', s.thread, s.thread.id, [...taskThreads, ...srThreads], (th) => ({ id: id(th.id), taskId: th.taskId ?? null, srId: th.srId ?? null,
        title: String(th.title ?? ''), modelId: th.modelId, createdBy: id(th.createdBy), createdAt: date(th.createdAt) }))
      const orderedMessages: Row[] = rows(b, 'messages').map((m, index) => ({ ...m, _index: index }))
      orderedMessages.sort((a, c) => String(a.threadId).localeCompare(String(c.threadId)) || String(a.createdAt).localeCompare(String(c.createdAt)) || a._index - c._index)
      const sequence = new Map<string, number>()
      const newMessages = await insert(tx, 'messages', 'message', s.message, s.message.id,
        children('messages', 'message', orderedMessages, 'threadId', 'threads', newThreads), (m) => {
        const threadId = id(m.threadId); const seq = (sequence.get(threadId) ?? 0) + 1; sequence.set(threadId, seq)
        return { id: id(m.id), threadId, seq, role: m.role, kind: m.kind, content: String(m.content ?? ''), authorId: m.authorId,
          status: m.status ?? 'done', error: m.error, createdAt: date(m.createdAt) }
      })
      const outputIds = new Set(rows(b, 'tasks').flatMap((t) => t.outputFileIds ?? []))
      const fileRows = [...rows(b, 'files')].sort((a, c) => Number(a.version ?? 1) - Number(c.version ?? 1))
      const fileIds = await existing(tx, s.fileObject, s.fileObject.id)
      for (const f of fileRows) {
        if (rows(b, 'assistants').some((a) => a.imageId === f.id && !newAssistants.has(id(a.id)))) {
          mark('files', 'file_object', false, '상위 행 건너뜀'); continue
        }
        if (f.originTaskId && !newTasks.has(id(f.originTaskId)) || f.originSrId && !newSrs.has(id(f.originSrId))) {
          if (f.originTaskId && !rows(b, 'tasks').some((t) => id(t.id) === id(f.originTaskId)) ||
            f.originSrId && !rows(b, 'serviceRequests').some((sr) => id(sr.id) === id(f.originSrId))) throw new Error(`files:${f.id} — 상위 행 없음`)
          mark('files', 'file_object', false, '상위 행 건너뜀'); continue
        }
        const name = validName(String(f.name ?? ''))
        if (typeof f.blobBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.blobBase64)) throw new Error(`파일 ${f.id}: blobBase64가 올바르지 않습니다`)
        const bytes = Buffer.from(f.blobBase64, 'base64')
        const kind = f.originSrId ? 'sr_attachment' : f.originTaskId ? 'task_file' : 'assistant_image'
        const metadata = { kind, originTaskId: f.originTaskId, originSrId: f.originSrId, originalName: name,
          mime: String(f.mime ?? 'application/octet-stream'), sizeBytes: bytes.length, sha256: sha256(bytes),
          source: f.source === 'assistant' ? 'assistant' : 'upload', isOutput: kind === 'task_file' && outputIds.has(f.id),
          version: Number(f.version ?? 1), previousId: f.previousId, uploadedBy: id(f.uploadedBy), uploadedAt: date(f.uploadedAt) }
        if (fileIds.has(id(f.id))) {
          const [old] = await tx.select().from(s.fileObject).where(eq(s.fileObject.id, id(f.id)))
          if (!old || !same(old, metadata)) conflicts.push(`file_object:${f.id}`)
          mark('files', 'file_object', false); continue
        }
        const storageKey = createStorageKey(name)
        if (!dryRun) { written.push(storageKey); await storage!.write(storageKey, bytes) }
        await tx.insert(s.fileObject).values({ id: id(f.id), ...metadata, storageKey })
        fileIds.add(id(f.id)); mark('files', 'file_object', true)
      }
      for (const a of rows(b, 'assistants')) if (a.imageId) {
        if (newAssistants.has(id(a.id))) await tx.update(s.assistant).set({ imageFileId: id(a.imageId) }).where(eq(s.assistant.id, id(a.id)))
        else {
          const [old] = await tx.select({ imageFileId: s.assistant.imageFileId }).from(s.assistant).where(eq(s.assistant.id, id(a.id)))
          if (old && old.imageFileId !== id(a.imageId)) conflicts.push(`assistant:${a.id}`)
        }
      }
      for (const sr of rows(b, 'serviceRequests')) {
        if (!newSrs.has(id(sr.id))) {
          for (const _ of sr.attachmentIds ?? []) mark('serviceRequests.attachmentIds', 'message_attachment', false, '상위 행 건너뜀')
          continue
        }
        if (!(sr.attachmentIds ?? []).length) continue
        const srThread = rows(b, 'threads').find((th) => th.srId === sr.id)
        if (!srThread || !newThreads.has(id(srThread.id))) throw new Error(`SR ${sr.id}: 접수 대화가 없습니다`)
        const [last] = await tx.select({ seq: sql<number>`coalesce(max(${s.message.seq}), 0)` }).from(s.message).where(eq(s.message.threadId, id(srThread.id)))
        const messageId = `${sr.id}:import-attachments`
        const attachmentMessage = await insert(tx, 'serviceRequests.attachmentIds', 'message', s.message, s.message.id, [{ id: messageId, sr, srThread, seq: Number(last?.seq ?? 0) + 1 }], (entry) => ({
          id: entry.id, threadId: id(entry.srThread.id), seq: entry.seq, role: 'user', kind: 'discussion', content: String(entry.sr.body ?? ''), status: 'done', createdAt: date(entry.sr.createdAt),
        }))
        for (const fileId of sr.attachmentIds) {
          if (!attachmentMessage.has(messageId)) { mark('serviceRequests.attachmentIds', 'message_attachment', false, '상위 행 건너뜀'); continue }
          await tx.insert(s.messageAttachment).values({ messageId, fileId: id(fileId) })
          mark('serviceRequests.attachmentIds', 'message_attachment', true)
        }
      }
      for (const t of rows(b, 'tasks')) {
        if (!newTasks.has(id(t.id))) {
          for (const [source, target, values] of [['tasks.assigneeIds', 'task_assignee', t.assigneeIds], ['tasks.tags', 'tag/task_tag', t.tags],
            ['tasks.inputs', 'task_input', t.inputs], ['tasks.checklist', 'checklist_item', t.checklist]] as const)
            for (const _ of values ?? []) mark(source, target, false, '상위 행 건너뜀')
          if (t.feedback) mark('tasks.feedback', 'task_feedback', false, '상위 행 건너뜀')
          if (t.checklistReview) mark('tasks.checklistReview', 'checklist_review', false, '상위 행 건너뜀')
          continue
        }
        for (const userId of t.assigneeIds ?? []) {
          const [old] = await tx.select().from(s.taskAssignee).where(sql`${s.taskAssignee.taskId} = ${t.id} and ${s.taskAssignee.userId} = ${userId}`)
          if (!old) await tx.insert(s.taskAssignee).values({ taskId: id(t.id), userId: id(userId) })
          mark('tasks.assigneeIds', 'task_assignee', !old)
        }
        for (const value of t.tags ?? []) {
          const tagKey = String(value)
          const [oldTag] = await tx.select().from(s.tag).where(eq(s.tag.key, tagKey))
          if (!oldTag) await tx.insert(s.tag).values({ key: tagKey, kind: tagKey.startsWith('SR-') ? 'sr' : 'keyword', label: tagKey })
          const [old] = await tx.select().from(s.taskTag).where(sql`${s.taskTag.taskId} = ${t.id} and ${s.taskTag.tagKey} = ${tagKey}`)
          if (!old) await tx.insert(s.taskTag).values({ taskId: id(t.id), tagKey, addedBy: id(t.createdBy), addedAt: date(t.createdAt) })
          mark('tasks.tags', 'tag/task_tag', !old)
        }
        for (const [sortOrder, input] of (t.inputs ?? []).entries()) {
          const [old] = await tx.select().from(s.taskInput).where(sql`${s.taskInput.taskId} = ${t.id} and ${s.taskInput.fileId} = ${input.fileId}`)
          if (!old) await tx.insert(s.taskInput).values({ taskId: id(t.id), fileId: id(input.fileId), weight: input.weight ?? 'reference', sortOrder,
            selectedBy: id(input.selectedBy ?? t.createdBy), selectedAt: date(input.selectedAt ?? t.createdAt) })
          mark('tasks.inputs', 'task_input', !old)
        }
        await insert(tx, 'tasks.checklist', 'checklist_item', s.checklistItem, s.checklistItem.id, t.checklist ?? [], (item: Row, sortOrder: number) => ({
          id: id(item.id), taskId: id(t.id), sortOrder, label: String(item.label), required: !!item.required, checked: !!item.checked,
          checkedBy: item.checkedBy, checkedAt: date(item.checkedAt) }))
        if (t.feedback) await insert(tx, 'tasks.feedback', 'task_feedback', s.taskFeedback, s.taskFeedback.taskId, [{ ...t.feedback, id: t.id }], (f) => ({
          taskId: id(t.id), rating: Number(f.rating), comment: String(f.comment ?? ''), byUser: id(f.by), at: date(f.at) }))
        if (t.checklistReview) {
          const review = t.checklistReview
          const reviewId = `${t.id}:import-review`
          const [old] = await tx.select().from(s.checklistReview).where(eq(s.checklistReview.id, reviewId))
          if (!old) await tx.insert(s.checklistReview).values({ id: reviewId, taskId: id(t.id), byUser: id(review.by), at: date(review.at), met: review.met, total: review.total, source: review.source })
          mark('tasks.checklistReview', 'checklist_review', !old)
          for (const item of review.items ?? []) {
            const [oldItem] = await tx.select().from(s.checklistReviewItem).where(sql`${s.checklistReviewItem.reviewId} = ${reviewId} and ${s.checklistReviewItem.itemId} = ${item.itemId}`)
            if (!oldItem) await tx.insert(s.checklistReviewItem).values({ reviewId, itemId: id(item.itemId), met: !!item.met, note: String(item.note ?? '') })
          }
        }
      }
      for (const m of rows(b, 'messages')) for (const fileId of m.attachmentIds ?? []) {
        if (!newMessages.has(id(m.id))) { mark('messages.attachmentIds', 'message_attachment', false, '상위 행 건너뜀'); continue }
        const [old] = await tx.select().from(s.messageAttachment).where(sql`${s.messageAttachment.messageId} = ${m.id} and ${s.messageAttachment.fileId} = ${fileId}`)
        if (!old) await tx.insert(s.messageAttachment).values({ messageId: id(m.id), fileId: id(fileId) })
        mark('messages.attachmentIds', 'message_attachment', !old)
      }
      for (const m of rows(b, 'messages')) if (m.requestSnapshot || m.requestInfo || m.heartbeatAt) mark('messages.requestInfo', '—', false, '서버 요청 기록과 구조 불일치')
      for (const m of rows(b, 'messages')) if (present(m.requestedBy)) mark('messages.requestedBy', '—', false, '서버 메시지 필드 없음')
      const newNotes = await insert(tx, 'notes', 'note', s.note, s.note.id,
        children('notes', 'note', rows(b, 'notes'), 'taskId', 'tasks', newTasks), (n) => ({ id: id(n.id), taskId: id(n.taskId), authorId: id(n.authorId), content: String(n.content), createdAt: date(n.createdAt) }))
      for (const n of rows(b, 'notes')) for (const fileId of n.attachmentIds ?? []) {
        if (!newNotes.has(id(n.id))) { mark('notes.attachmentIds', 'note_attachment', false, '상위 행 건너뜀'); continue }
        const [old] = await tx.select().from(s.noteAttachment).where(sql`${s.noteAttachment.noteId} = ${n.id} and ${s.noteAttachment.fileId} = ${fileId}`)
        if (!old) await tx.insert(s.noteAttachment).values({ noteId: id(n.id), fileId: id(fileId) })
        mark('notes.attachmentIds', 'note_attachment', !old)
      }
      for (const sr of rows(b, 'serviceRequests')) {
        for (const result of sr.results ?? []) {
          if (!newSrs.has(id(sr.id))) { mark('serviceRequests.results', 'shared_result', false, '상위 행 건너뜀');
            for (const _ of result.fileIds ?? []) mark('serviceRequests.results.fileIds', 'shared_result_file', false, '상위 행 건너뜀')
            continue }
          const [old] = await tx.select().from(s.sharedResult).where(eq(s.sharedResult.id, id(result.id)))
          const value = { id: id(result.id), srId: id(sr.id), taskId: result.taskId, text: String(result.text ?? ''), byUser: id(result.by), at: date(result.at) }
          if (old && !same(old, value)) conflicts.push(`shared_result:${result.id}`)
          if (!old) await tx.insert(s.sharedResult).values(value)
          mark('serviceRequests.results', 'shared_result', !old)
          for (const fileId of result.fileIds ?? []) {
            if (old) { mark('serviceRequests.results.fileIds', 'shared_result_file', false, '상위 행 건너뜀'); continue }
            const [oldFile] = await tx.select().from(s.sharedResultFile).where(sql`${s.sharedResultFile.resultId} = ${result.id} and ${s.sharedResultFile.fileId} = ${fileId}`)
            if (!oldFile) await tx.insert(s.sharedResultFile).values({ resultId: id(result.id), fileId: id(fileId) })
            mark('serviceRequests.results.fileIds', 'shared_result_file', !oldFile)
          }
        }
      }
      const newActivity = rows(b, 'activity').filter((a) => {
        const blocked = a.taskId && !newTasks.has(id(a.taskId)) || a.srId && !newSrs.has(id(a.srId))
        if (blocked) mark('activity', 'activity_log', false, '상위 행 건너뜀')
        return !blocked
      })
      await insert(tx, 'activity', 'activity_log', s.activityLog, s.activityLog.id, newActivity, (a) => ({
        id: id(a.id), type: String(a.type), userId: id(a.userId), taskId: a.taskId, assistantId: a.assistantId, srId: a.srId,
        payload: a.payload ?? {}, at: date(a.at) }))
      await insert(tx, 'notifications', 'notification', s.notification, s.notification.id, rows(b, 'notifications'), (n) => ({
        id: id(n.id), userId: id(n.userId), title: String(n.title), body: String(n.body ?? ''), link: String(n.link ?? ''), at: date(n.at), readAt: n.read ? date(n.at) : null }))
      const newSnapshots = await insert(tx, 'contextSnapshots', 'context_snapshot', s.contextSnapshot, s.contextSnapshot.id,
        children('contextSnapshots', 'context_snapshot', rows(b, 'contextSnapshots'), 'sourceTaskId', 'tasks', newTasks), (snap) => ({
        id: id(snap.id), sourceTaskId: id(snap.sourceTaskId), mode: snap.mode, upToMessageId: snap.upToMessageId, summaryText: snap.summaryText,
        summarySource: snap.summarySource, summaryModel: snap.summaryModel, createdBy: id(snap.createdBy), createdAt: date(snap.createdAt) }))
      for (const snap of rows(b, 'contextSnapshots')) for (const [seq, messageId] of (snap.messageIds ?? []).entries()) {
        if (!newSnapshots.has(id(snap.id))) { mark('contextSnapshots.messageIds', 'context_snapshot_message', false, '상위 행 건너뜀'); continue }
        const [old] = await tx.select().from(s.contextSnapshotMessage).where(sql`${s.contextSnapshotMessage.snapshotId} = ${snap.id} and ${s.contextSnapshotMessage.messageId} = ${messageId}`)
        if (!old) await tx.insert(s.contextSnapshotMessage).values({ snapshotId: id(snap.id), messageId: id(messageId), seq })
        mark('contextSnapshots.messageIds', 'context_snapshot_message', !old)
      }
      await insert(tx, 'conversationInputs', 'conversation_input', s.conversationInput, s.conversationInput.id,
        children('conversationInputs', 'conversation_input', rows(b, 'conversationInputs'), 'taskId', 'tasks', newTasks), (c) => ({
        id: id(c.id), taskId: id(c.taskId), sourceTaskId: id(c.sourceTaskId), weight: c.weight, mode: c.mode, snapshotId: id(c.snapshotId),
        selectedBy: id(c.selectedBy), selectedAt: date(c.selectedAt) }))
      for (const setting of rows(b, 'settings')) {
        for (const [key, value] of [['srIntakeAssistantId', setting.srIntakeAssistantId], ['requestBudgetBytes', setting.requestBudgetBytes]] as const) {
          if (!present(value)) continue
          const [old] = await tx.select().from(s.appSetting).where(eq(s.appSetting.key, key))
          if (!old) await tx.insert(s.appSetting).values({ key, value })
          mark('settings', 'app_setting', !old)
        }
        if (setting.llm) mark('settings.llm', '—', false, '서버 비밀/연결 설정 제외')
        if (setting.currentUserId) mark('settings.currentUserId', '—', false, '브라우저별 사용자 상태 제외')
      }
      for (const file of rows(b, 'files')) {
        if (file.remoteIds) mark('files.remoteIds', '—', false, '원격 캐시 제외')
        if (file.tags?.length) mark('files.tags', '—', false, '서버 파일 태그 없음')
      }
      for (const thread of rows(b, 'threads')) if (thread.archived) mark('threads.archived', '—', false, '서버 대응 없음')
      for (const activity of rows(b, 'activity')) if (activity.packageId) mark('activity.packageId', '—', false, '패키지 모델 제거')
      skip('packages', '—', '서버 대응 없음')
      skip('packageReceipts', '—', '서버 대응 없음')
      const handled = new Set(['users', 'assistants', 'serviceRequests', 'tasks', 'threads', 'messages', 'files', 'notes', 'activity', 'notifications', 'settings', 'conversationInputs', 'contextSnapshots', 'packages', 'packageReceipts'])
      for (const name of Object.keys(b.tables)) if (!handled.has(name)) skip(name, '—', '서버 대응 없음')
      if (conflicts.length) throw new Error(`ID 충돌: ${[...new Set(conflicts)].join(', ')}`)
      if (dryRun) throw new DryRunComplete()
    })
  } catch (error) {
    if (!(error instanceof DryRunComplete)) {
      for (const key of written.reverse()) await storage!.remove(key)
      throw error
    }
  }
  return { report, credentials }
}

class DryRunComplete extends Error {}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const file = args.find((arg) => arg !== '--dry-run')
  if (!file || args.some((arg) => arg !== file && arg !== '--dry-run')) throw new Error('사용법: db:import <bundle.json> [--dry-run]')
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다')
  const maxBytes = Number(process.env.IMPORT_BUNDLE_MAX_BYTES ?? 1024 ** 3)
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('IMPORT_BUNDLE_MAX_BYTES는 양의 정수여야 합니다')
  if ((await stat(resolve(file))).size > maxBytes) throw new Error(`bundle 크기가 제한(${maxBytes} bytes)을 초과합니다`)
  const source = await readFile(resolve(file))
  if (source.byteLength > maxBytes) throw new Error(`bundle 크기가 제한(${maxBytes} bytes)을 초과합니다`)
  const input = JSON.parse(source.toString('utf8')) as unknown
  const client = createPool(process.env.DATABASE_URL)
  try {
    const dryRun = args.includes('--dry-run')
    const storage = dryRun ? undefined : new FileStorageService(resolve(process.env.FILE_STORAGE_ROOT ?? 'storage'))
    const result = await importBundle(input, drizzle(client), storage, dryRun)
    for (const [name, counts] of Object.entries(result.report)) console.log(`${name}: 가져올 ${counts.imported}, 건너뛸 ${counts.skipped}${counts.reason ? ` (${counts.reason})` : ''}`)
    for (const entry of result.credentials) console.log(`${entry.loginId}\t${entry.password}`)
  } finally { await client.end() }
}
