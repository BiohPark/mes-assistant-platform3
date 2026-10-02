import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { drizzle } from 'drizzle-orm/mysql2'
import { desc, eq, sql } from 'drizzle-orm'
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
const nullableId = (value: unknown) => present(value) ? id(value) : null
const keyOf = (source: string, target: string) => `${source} → ${target}`
const validBase64 = (value: unknown): value is string => typeof value === 'string' && value.length % 4 === 0 &&
  !/[^A-Za-z0-9+/=]/.test(value) && (value.indexOf('=') === -1 || value.indexOf('=') >= value.length - 2 && /^={1,2}$/.test(value.slice(value.indexOf('='))))
export type ImportReport = Record<string, { imported: number; skipped: number; reason?: string }>
export type CodeMapping = { kind: 'WK' | 'SR'; id: string; from: string; to: string }
export const DEFAULT_IMPORT_BUNDLE_MAX_BYTES = 64 * 1024 ** 2
export type ImportOptions = { defaultOwner?: string; allowMultiSr?: boolean }
const same = (actual: Row, expected: Row) => Object.entries(expected).every(([key, value]) => value === undefined ||
  (value instanceof Date ? new Date(actual[key]).getTime() === value.getTime() :
    typeof value === 'object' && value !== null ? JSON.stringify(actual[key]) === JSON.stringify(value) : (actual[key] ?? null) === (value ?? null)))

export async function importBundle(input: unknown, db: Db, storage: FileStorageService | undefined, dryRun = false, options: ImportOptions = {}): Promise<{ report: ImportReport; codeMappings: CodeMapping[]; credentials: { loginId: string; password: string }[] }> {
  const b = normalizeBundle(input)
  const report: ImportReport = {}
  const credentials: { loginId: string; password: string }[] = []
  const written: string[] = []
  const conflicts: string[] = []
  const codeMappings: CodeMapping[] = []
  const known = new WeakMap<object, Set<string>>()
  const mark = (source: string, target: string, imported: boolean, reason?: string) => {
    const key = keyOf(source, target)
    const item = report[key] ??= { imported: 0, skipped: 0 }
    if (imported) item.imported++
    else { item.skipped++; if (reason && reason !== '상위 행 건너뜀') item.reason = reason; else item.reason ??= reason ?? '이미 존재' }
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
    allow?: (row: Row) => boolean, catalog = false) => {
    const seen = await existing(tx, table, primary)
    const created = new Set<string>()
    for (const [i, row] of items.entries()) {
      if (catalog && seen.has(id(row.id)) && !created.has(id(row.id))) {
        mark(source, target, false, '서버 카탈로그 값 유지 (차이 있음)')
        continue
      }
      const value = convert(row, i)
      const rowId = id(value.id ?? value.key ?? value.taskId)
      if (seen.has(rowId)) {
        const [old] = await tx.select().from(table).where(eq(primary, rowId))
        const differs = created.has(rowId) || !old || !same(old, value)
        if (differs && !catalog) conflicts.push(`${target}:${rowId}`)
        mark(source, target, false, differs && catalog ? '서버 카탈로그 값 유지 (차이 있음)' : undefined); continue
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
      const assignedCodes = new Map<string, string>()
      const mapCodes = async (source: 'serviceRequests' | 'tasks', kind: 'SR' | 'WK') => {
        const items = rows(b, source).filter((row) => present(row.code))
        const years = [...new Set(items.map((row) => new RegExp(`^${kind}-(\\d{4})-\\d+`).exec(String(row.code))?.[1]).filter((year): year is string => !!year))].sort()
        for (const year of years) {
          const lockKey = `${kind === 'SR' ? 'sr' : 'task'}-code:${year}`
          await tx.insert(s.dbLock).values({ lockKey }).onDuplicateKeyUpdate({ set: { lockKey } })
          await tx.select().from(s.dbLock).where(eq(s.dbLock.lockKey, lockKey)).for('update')
        }
        const existingRows: { id: string; code: string | null }[] = kind === 'SR'
          ? await tx.select({ id: s.serviceRequest.id, code: s.serviceRequest.code }).from(s.serviceRequest)
          : await tx.select({ id: s.task.id, code: s.task.code }).from(s.task)
        const byId = new Map(existingRows.map((row) => [row.id, row.code]))
        const used = new Set(existingRows.map((row) => row.code).filter((code): code is string => !!code))
        const reserved = new Set(items.map((row) => String(row.code)))
        const maxByYear = new Map(years.map((year) => [year, Math.max(0, ...existingRows.filter((row) => row.code?.startsWith(`${kind}-${year}-`))
          .map((row) => Number(new RegExp(`^${kind}-${year}-(\\d+)`).exec(row.code!)?.[1] ?? 0)))]))
        for (const row of items) {
          const from = String(row.code)
          const year = from.slice(3, 7)
          let to = byId.get(id(row.id)) || from
          if (!byId.has(id(row.id)) && used.has(to)) {
            if (!years.includes(year)) throw new Error(`${source}:${row.id} — 중복된 업무 번호를 재발급할 수 없습니다`)
            let next = maxByYear.get(year) ?? 0
            do { to = `${kind}-${year}-${String(++next).padStart(4, '0')}` } while (used.has(to) || reserved.has(to))
            maxByYear.set(year, next)
          }
          used.add(to)
          assignedCodes.set(`${kind}:${row.id}`, to)
          if (to !== from) codeMappings.push({ kind, id: id(row.id), from, to })
        }
      }
      await mapCodes('serviceRequests', 'SR')
      await mapCodes('tasks', 'WK')
      const srCodeBySource = new Map(codeMappings.filter((entry) => entry.kind === 'SR').map((entry) => [entry.from, entry.to]))
      const taskTags = (task: Row): string[] => (task.tags ?? []).map((tag: string) => srCodeBySource.get(tag) ?? tag)
      const loginToUser = new Map((await tx.select({ id: s.appUser.id, loginId: s.appUser.loginId }).from(s.appUser)).filter((x) => !!x.loginId).map((x) => [x.loginId!, x.id]))
      const usedLogins = new Set(loginToUser.keys())
      const users = await existing(tx, s.appUser, s.appUser.id)
      function userRef(value: unknown, label: string): string
      function userRef(value: unknown, label: string, nullable: true): string | null
      function userRef(value: unknown, label: string, nullable = false): string | null {
        if (present(value)) return id(value)
        if (nullable) return null
        const fallback = options.defaultOwner
        const fallbackId = fallback && loginToUser.get(fallback)
        if (!fallbackId || !users.has(id(fallbackId))) throw new Error(`${label}: 소유자 미지정 — --default-owner <loginId>가 필요합니다`)
        return id(fallbackId)
      }
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
        users.add(id(row.id)); loginToUser.set(loginId, id(row.id)); mark('users', 'app_user', true)
      }
      const level1 = [...new Set(rows(b, 'assistants').map((a) => String(a.level1 ?? '이전 데모')))]
      const level2 = [...new Set(rows(b, 'assistants').map((a) => String(a.level2 ?? '기타')))]
      for (const [group, names] of [['assistant_level1', level1], ['assistant_level2', level2]] as const) {
        if (!names.length) continue
        const [old] = await tx.select().from(s.codeGroup).where(eq(s.codeGroup.key, group))
        if (!old) await tx.insert(s.codeGroup).values({ key: group, name: group === 'assistant_level1' ? '업무 Lv1' : '업무 Lv2' })
        mark('assistants.levels', 'code_group', !old, old && old.name !== (group === 'assistant_level1' ? '업무 Lv1' : '업무 Lv2') ? '서버 카탈로그 값 유지 (차이 있음)' : undefined)
        for (const [i, name] of names.entries()) {
          const codeId = `${group}:${name}`
          const [oldCode] = await tx.select().from(s.code).where(eq(s.code.id, codeId))
          if (!oldCode) await tx.insert(s.code).values({ id: codeId, groupKey: group, code: name, name, sortOrder: i })
          mark('assistants.levels', 'code', !oldCode, oldCode && !same(oldCode, { groupKey: group, code: name, name, sortOrder: i }) ? '서버 카탈로그 값 유지 (차이 있음)' : undefined)
        }
      }
      const newAssistants = await insert(tx, 'assistants', 'assistant', s.assistant, s.assistant.id, rows(b, 'assistants'), (a, i) => ({
        id: id(a.id), name: String(a.name), level1CodeId: `assistant_level1:${a.level1 ?? '이전 데모'}`, level2CodeId: `assistant_level2:${a.level2 ?? '기타'}`,
        summary: String(a.summary ?? ''), sortOrder: a.order ?? i, modelId: a.modelId ?? null, link1: a.link1 ?? null, docUrl: a.docUrl ?? null,
        ownerId: userRef(a.ownerId, `assistant:${a.id}`), status: a.status === 'working' ? 'developing' : a.status, usageExample: String(a.usageExample ?? ''),
        color: String(a.color ?? '#64748b'), createdBy: userRef(a.createdBy || a.ownerId, `assistant:${a.id}.createdBy`), createdAt: date(a.createdAt), updatedAt: date(a.updatedAt),
      }), undefined, true)
      for (const a of rows(b, 'assistants')) {
        if (!newAssistants.has(id(a.id))) {
          for (const [direction, labels] of [['input', a.expectedInputs ?? []], ['output', a.expectedOutputs ?? []]] as const) for (const [sortOrder, label] of labels.entries()) {
            const [old] = await tx.select().from(s.assistantExpectedIo).where(sql`${s.assistantExpectedIo.assistantId} = ${id(a.id)} and ${s.assistantExpectedIo.direction} = ${direction} and ${s.assistantExpectedIo.sortOrder} = ${sortOrder}`)
            mark('assistants.expectedIo', 'assistant_expected_io', false, old?.label === String(label) ? '상위 행 건너뜀' : '서버 카탈로그 값 유지 (차이 있음)')
          }
          for (const [sortOrder, item] of (a.checklistTemplate ?? []).entries()) {
            const [old] = await tx.select().from(s.assistantChecklistTemplate).where(eq(s.assistantChecklistTemplate.id, id(item.id)))
            mark('assistants.checklistTemplate', 'assistant_checklist_template', false, old && same(old, { assistantId: id(a.id), sortOrder, label: String(item.label), required: !!item.required }) ? '상위 행 건너뜀' : '서버 카탈로그 값 유지 (차이 있음)')
          }
          continue
        }
        for (const [direction, labels] of [['input', a.expectedInputs ?? []], ['output', a.expectedOutputs ?? []]] as const) {
          for (const [sortOrder, label] of labels.entries()) {
            const [old] = await tx.select().from(s.assistantExpectedIo).where(sql`${s.assistantExpectedIo.assistantId} = ${a.id} and ${s.assistantExpectedIo.direction} = ${direction} and ${s.assistantExpectedIo.sortOrder} = ${sortOrder}`)
          if (!old) await tx.insert(s.assistantExpectedIo).values({ assistantId: id(a.id), direction, sortOrder, label: String(label) })
          mark('assistants.expectedIo', 'assistant_expected_io', !old, old && old.label !== String(label) ? '서버 카탈로그 값 유지 (차이 있음)' : undefined)
          }
        }
        await insert(tx, 'assistants.checklistTemplate', 'assistant_checklist_template', s.assistantChecklistTemplate, s.assistantChecklistTemplate.id,
          a.checklistTemplate ?? [], (item: Row, i: number) => ({ id: id(item.id), assistantId: id(a.id), sortOrder: i, label: String(item.label), required: !!item.required }), undefined, true)
      }
      const newSrs = await insert(tx, 'serviceRequests', 'service_request', s.serviceRequest, s.serviceRequest.id, rows(b, 'serviceRequests'), (sr) => ({
        id: id(sr.id), code: assignedCodes.get(`SR:${sr.id}`) ?? null, requesterId: userRef(sr.requesterId, `service_request:${sr.id}.requesterId`), title: String(sr.title ?? ''), titleSource: sr.titleSource ?? (sr.title ? 'manual' : 'default'),
        body: String(sr.body ?? ''), status: sr.status ?? 'draft', submittedAt: date(sr.submittedAt) ?? null, createdAt: date(sr.createdAt), updatedAt: date(sr.updatedAt),
      }))
      const srByCode = new Map<string, Row>(rows(b, 'serviceRequests').filter((sr) => sr.code).map((sr) => [String(sr.code), sr]))
      const linkedSrs = (t: Row) => [...new Map<string, Row>((t.tags ?? []).map((tag: string) => srByCode.get(tag)).filter((sr: Row | undefined): sr is Row => !!sr).map((sr: Row) => [id(sr.id), sr])).values()]
        .sort((a, c) => String(a.createdAt ?? '').localeCompare(String(c.createdAt ?? '')) || id(a.id).localeCompare(id(c.id)))
      const multiSr = rows(b, 'tasks').filter((t) => linkedSrs(t).length > 1)
      if (multiSr.length && !options.allowMultiSr) throw new Error(`다중 SR 업무: ${multiSr.map((t) => `${t.id} (${linkedSrs(t).map((sr) => sr.code).join(', ')})`).join('; ')} — --allow-multi-sr가 필요합니다`)
      const newTasks = await insert(tx, 'tasks', 'task', s.task, s.task.id, rows(b, 'tasks'), (t) => ({
        id: id(t.id), code: assignedCodes.get(`WK:${t.id}`) ?? String(t.code), assistantId: id(t.assistantId), srId: linkedSrs(t)[0]?.id ?? null, title: String(t.title), titleSource: t.titleSource ?? 'manual',
        summary: String(t.summary ?? ''), status: t.status ?? 'todo', ownerId: userRef(t.ownerId, `task:${t.id}`), priority: t.priority ?? 'normal',
        dueDate: typeof t.dueDate === 'string' ? t.dueDate.slice(0, 10) : null, modelId: t.modelId ?? null,
        createdBy: userRef(t.createdBy, `task:${t.id}.createdBy`), createdAt: date(t.createdAt), lastActivityAt: date(t.lastActivityAt ?? t.createdAt),
        startedAt: date(t.startedAt) ?? null, completedAt: date(t.completedAt) ?? null, completedBy: userRef(t.completedBy, `task:${t.id}.completedBy`, true),
      }))
      for (const t of rows(b, 'tasks')) for (const _ of linkedSrs(t).slice(1)) mark('tasks.tags', 'task.sr_id', false, '다중 SR 연결 손실')
      for (const th of rows(b, 'threads')) if (!!th.taskId === !!th.srId) throw new Error(`threads:${th.id} — taskId 또는 srId 하나가 필요합니다`)
      const taskThreads = children('threads', 'thread', rows(b, 'threads').filter((th) => th.taskId), 'taskId', 'tasks', newTasks)
      const srThreads = children('threads', 'thread', rows(b, 'threads').filter((th) => th.srId), 'srId', 'serviceRequests', newSrs)
      const newThreads = await insert(tx, 'threads', 'thread', s.thread, s.thread.id, [...taskThreads, ...srThreads], (th) => ({ id: id(th.id), taskId: nullableId(th.taskId), srId: nullableId(th.srId),
        title: String(th.title ?? ''), modelId: th.modelId ?? null, createdBy: userRef(th.createdBy, `thread:${th.id}.createdBy`), createdAt: date(th.createdAt) }))
      const orderedMessages: Row[] = rows(b, 'messages').map((m, index) => ({ ...m, _index: index }))
      orderedMessages.sort((a, c) => String(a.threadId).localeCompare(String(c.threadId)) || String(a.createdAt).localeCompare(String(c.createdAt)) || a._index - c._index)
      const sequence = new Map<string, number>()
      const newMessages = await insert(tx, 'messages', 'message', s.message, s.message.id,
        children('messages', 'message', orderedMessages, 'threadId', 'threads', newThreads), (m) => {
        const threadId = id(m.threadId); const seq = (sequence.get(threadId) ?? 0) + 1; sequence.set(threadId, seq)
        return { id: id(m.id), threadId, seq, role: m.role, kind: m.kind ?? null, content: String(m.content ?? ''), authorId: userRef(m.authorId, `message:${m.id}.authorId`, true),
          status: m.status ?? 'done', error: m.error ?? null, createdAt: date(m.createdAt) }
      })
      const outputIds = new Set(rows(b, 'tasks').flatMap((t) => t.outputFileIds ?? []))
      const fileRows = [...rows(b, 'files')].sort((a, c) => Number(a.version ?? 1) - Number(c.version ?? 1))
      const fileIds = await existing(tx, s.fileObject, s.fileObject.id)
      for (const f of fileRows) {
        if (f.originTaskId && !(await existing(tx, s.task, s.task.id)).has(id(f.originTaskId)) ||
          f.originSrId && !(await existing(tx, s.serviceRequest, s.serviceRequest.id)).has(id(f.originSrId))) throw new Error(`files:${f.id} — 원본 업무 없음`)
        const name = validName(String(f.name ?? ''))
        if (!validBase64(f.blobBase64)) throw new Error(`파일 ${f.id}: blobBase64가 올바르지 않습니다`)
        const bytes = Buffer.from(f.blobBase64, 'base64')
        const kind = f.originSrId ? 'sr_attachment' : f.originTaskId ? 'task_file' : 'assistant_image'
        const metadata = { kind, originTaskId: nullableId(f.originTaskId), originSrId: nullableId(f.originSrId), originalName: name,
          mime: String(f.mime ?? 'application/octet-stream'), sizeBytes: bytes.length, sha256: sha256(bytes),
          source: f.source === 'assistant' ? 'assistant' : 'upload', isOutput: kind === 'task_file' && outputIds.has(f.id),
          version: Number(f.version ?? 1), previousId: nullableId(f.previousId), uploadedBy: userRef(f.uploadedBy, `file:${f.id}.uploadedBy`), uploadedAt: date(f.uploadedAt) }
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
          if (old && old.imageFileId !== id(a.imageId)) mark('assistants.imageId', 'assistant.image_file_id', false, '서버 카탈로그 값 유지 (차이 있음)')
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
        const [firstUser] = await tx.select().from(s.message).where(sql`${s.message.threadId} = ${id(srThread.id)} and ${s.message.role} = 'user'`).orderBy(s.message.seq).limit(1)
        if (firstUser) {
          for (const fileId of sr.attachmentIds) {
            const [old] = await tx.select().from(s.messageAttachment).where(sql`${s.messageAttachment.messageId} = ${firstUser.id} and ${s.messageAttachment.fileId} = ${fileId}`)
            if (!old) await tx.insert(s.messageAttachment).values({ messageId: firstUser.id, fileId: id(fileId) })
            mark('serviceRequests.attachmentIds', 'message_attachment', !old)
          }
          continue
        }
        const [last] = await tx.select({ seq: s.message.seq, createdAt: s.message.createdAt }).from(s.message)
          .where(eq(s.message.threadId, id(srThread.id))).orderBy(desc(s.message.seq)).limit(1)
        const messageId = `${sr.id}:import-attachments`
        const attachmentMessage = await insert(tx, 'serviceRequests.attachmentIds', 'message', s.message, s.message.id, [{ id: messageId, sr, srThread, seq: Number(last?.seq ?? 0) + 1 }], (entry) => ({
          id: entry.id, threadId: id(entry.srThread.id), seq: entry.seq, role: 'user', kind: 'discussion', content: '', authorId: userRef(entry.sr.requesterId, `service_request:${entry.sr.id}.requesterId`),
          status: 'done', createdAt: last?.createdAt ?? date(entry.sr.createdAt),
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
        for (const value of taskTags(t)) {
          const tagKey = String(value)
          const [oldTag] = await tx.select().from(s.tag).where(eq(s.tag.key, tagKey))
          if (!oldTag) await tx.insert(s.tag).values({ key: tagKey, kind: tagKey.startsWith('SR-') ? 'sr' : 'keyword', label: tagKey })
          const [old] = await tx.select().from(s.taskTag).where(sql`${s.taskTag.taskId} = ${t.id} and ${s.taskTag.tagKey} = ${tagKey}`)
          if (old && !same(old, { addedBy: userRef(t.createdBy, `task:${t.id}.createdBy`), addedAt: date(t.createdAt) })) conflicts.push(`task_tag:${t.id}/${tagKey}`)
          if (!old) await tx.insert(s.taskTag).values({ taskId: id(t.id), tagKey, addedBy: userRef(t.createdBy, `task:${t.id}.createdBy`), addedAt: date(t.createdAt) })
          mark('tasks.tags', 'tag/task_tag', !old)
        }
        for (const [sortOrder, input] of (t.inputs ?? []).entries()) {
          const [old] = await tx.select().from(s.taskInput).where(sql`${s.taskInput.taskId} = ${t.id} and ${s.taskInput.fileId} = ${input.fileId}`)
          if (old && !same(old, { weight: input.weight ?? 'reference', sortOrder, selectedBy: userRef(input.selectedBy || t.createdBy, `task:${t.id}.inputs.selectedBy`), selectedAt: date(input.selectedAt ?? t.createdAt) })) conflicts.push(`task_input:${t.id}/${input.fileId}`)
          if (!old) await tx.insert(s.taskInput).values({ taskId: id(t.id), fileId: id(input.fileId), weight: input.weight ?? 'reference', sortOrder,
            selectedBy: userRef(input.selectedBy || t.createdBy, `task:${t.id}.inputs.selectedBy`), selectedAt: date(input.selectedAt ?? t.createdAt) })
          mark('tasks.inputs', 'task_input', !old)
        }
        await insert(tx, 'tasks.checklist', 'checklist_item', s.checklistItem, s.checklistItem.id, t.checklist ?? [], (item: Row, sortOrder: number) => ({
          id: id(item.id), taskId: id(t.id), sortOrder, label: String(item.label), required: !!item.required, checked: !!item.checked,
          checkedBy: userRef(item.checkedBy, `checklist_item:${item.id}.checkedBy`, true), checkedAt: date(item.checkedAt) ?? null }))
        if (t.feedback) await insert(tx, 'tasks.feedback', 'task_feedback', s.taskFeedback, s.taskFeedback.taskId, [{ ...t.feedback, id: t.id }], (f) => ({
          taskId: id(t.id), rating: Number(f.rating), comment: String(f.comment ?? ''), byUser: userRef(f.by, `task_feedback:${t.id}.by`), at: date(f.at) }))
        if (t.checklistReview) {
          const review = t.checklistReview
          const reviewId = `${t.id}:import-review`
          const [old] = await tx.select().from(s.checklistReview).where(eq(s.checklistReview.id, reviewId))
          if (old && !same(old, { taskId: id(t.id), byUser: userRef(review.by, `checklist_review:${reviewId}.by`), at: date(review.at), met: review.met, total: review.total, source: review.source })) conflicts.push(`checklist_review:${reviewId}`)
          if (!old) await tx.insert(s.checklistReview).values({ id: reviewId, taskId: id(t.id), byUser: userRef(review.by, `checklist_review:${reviewId}.by`), at: date(review.at), met: review.met, total: review.total, source: review.source })
          mark('tasks.checklistReview', 'checklist_review', !old)
          for (const item of review.items ?? []) {
            const [oldItem] = await tx.select().from(s.checklistReviewItem).where(sql`${s.checklistReviewItem.reviewId} = ${reviewId} and ${s.checklistReviewItem.itemId} = ${item.itemId}`)
            if (oldItem && !same(oldItem, { met: !!item.met, note: String(item.note ?? '') })) conflicts.push(`checklist_review_item:${reviewId}/${item.itemId}`)
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
        children('notes', 'note', rows(b, 'notes'), 'taskId', 'tasks', newTasks), (n) => ({ id: id(n.id), taskId: id(n.taskId), authorId: userRef(n.authorId, `note:${n.id}.authorId`), content: String(n.content), createdAt: date(n.createdAt) }))
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
          const value = { id: id(result.id), srId: id(sr.id), taskId: nullableId(result.taskId), text: String(result.text ?? ''), byUser: userRef(result.by, `shared_result:${result.id}.by`), at: date(result.at) }
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
        id: id(a.id), type: String(a.type), userId: userRef(a.userId, `activity:${a.id}.userId`), taskId: nullableId(a.taskId), assistantId: nullableId(a.assistantId), srId: nullableId(a.srId),
        payload: a.payload ?? {}, at: date(a.at) }))
      await insert(tx, 'notifications', 'notification', s.notification, s.notification.id, rows(b, 'notifications'), (n) => ({
        id: id(n.id), userId: userRef(n.userId, `notification:${n.id}.userId`), title: String(n.title), body: String(n.body ?? ''), link: String(n.link ?? ''), at: date(n.at), readAt: n.read ? date(n.at) : null }))
      for (const snap of rows(b, 'contextSnapshots')) if (!(await existing(tx, s.task, s.task.id)).has(id(snap.sourceTaskId))) throw new Error(`contextSnapshots:${snap.id} — 원본 업무 없음`)
      const newSnapshots = await insert(tx, 'contextSnapshots', 'context_snapshot', s.contextSnapshot, s.contextSnapshot.id,
        rows(b, 'contextSnapshots'), (snap) => ({
        id: id(snap.id), sourceTaskId: id(snap.sourceTaskId), mode: snap.mode, upToMessageId: nullableId(snap.upToMessageId), summaryText: snap.summaryText ?? null,
        summarySource: snap.summarySource ?? null, summaryModel: snap.summaryModel ?? null, createdBy: userRef(snap.createdBy, `context_snapshot:${snap.id}.createdBy`), createdAt: date(snap.createdAt) }))
      for (const snap of rows(b, 'contextSnapshots')) for (const [seq, messageId] of (snap.messageIds ?? []).entries()) {
        if (!newSnapshots.has(id(snap.id))) { mark('contextSnapshots.messageIds', 'context_snapshot_message', false, '상위 행 건너뜀'); continue }
        const [old] = await tx.select().from(s.contextSnapshotMessage).where(sql`${s.contextSnapshotMessage.snapshotId} = ${snap.id} and ${s.contextSnapshotMessage.messageId} = ${messageId}`)
        if (old && old.seq !== seq) conflicts.push(`context_snapshot_message:${snap.id}/${messageId}`)
        if (!old) await tx.insert(s.contextSnapshotMessage).values({ snapshotId: id(snap.id), messageId: id(messageId), seq })
        mark('contextSnapshots.messageIds', 'context_snapshot_message', !old)
      }
      await insert(tx, 'conversationInputs', 'conversation_input', s.conversationInput, s.conversationInput.id,
        children('conversationInputs', 'conversation_input', rows(b, 'conversationInputs'), 'taskId', 'tasks', newTasks), (c) => ({
        id: id(c.id), taskId: id(c.taskId), sourceTaskId: id(c.sourceTaskId), weight: c.weight, mode: c.mode, snapshotId: id(c.snapshotId),
        selectedBy: userRef(c.selectedBy, `conversation_input:${c.id}.selectedBy`), selectedAt: date(c.selectedAt) }))
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
      // 기존 상위 행은 병합하지 않는다. bundle의 하위 행이 하나라도 없으면 전체 이관을 취소한다.
      const missing: string[] = []
      const requireChild = async (table: any, where: any, label: string, expected?: Row) => {
        const [found] = await tx.select().from(table).where(where).limit(1)
        if (!found) missing.push(label)
        else if (expected && !same(found, expected)) conflicts.push(label)
      }
      const skippedParent = (source: string, value: unknown, created: Set<string>) =>
        rows(b, source).some((row) => id(row.id) === id(value)) && !created.has(id(value))
      for (const th of rows(b, 'threads')) if (th.taskId && skippedParent('tasks', th.taskId, newTasks) || th.srId && skippedParent('serviceRequests', th.srId, newSrs))
        await requireChild(s.thread, eq(s.thread.id, id(th.id)), `thread:${th.id}`, { taskId: nullableId(th.taskId), srId: nullableId(th.srId),
          title: String(th.title ?? ''), modelId: th.modelId ?? null, createdBy: userRef(th.createdBy, `thread:${th.id}.createdBy`), createdAt: date(th.createdAt) })
      for (const m of rows(b, 'messages')) if (skippedParent('threads', m.threadId, newThreads))
        await requireChild(s.message, eq(s.message.id, id(m.id)), `message:${m.id}`, { threadId: id(m.threadId), seq: orderedMessages.filter((item) => item.threadId === m.threadId).findIndex((item) => item.id === m.id) + 1,
          role: m.role, kind: m.kind ?? null, content: String(m.content ?? ''), authorId: userRef(m.authorId, `message:${m.id}.authorId`, true), status: m.status ?? 'done', error: m.error ?? null, createdAt: date(m.createdAt) })
      for (const n of rows(b, 'notes')) if (skippedParent('tasks', n.taskId, newTasks))
        await requireChild(s.note, eq(s.note.id, id(n.id)), `note:${n.id}`, { taskId: id(n.taskId), authorId: userRef(n.authorId, `note:${n.id}.authorId`), content: String(n.content), createdAt: date(n.createdAt) })
      for (const c of rows(b, 'conversationInputs')) if (skippedParent('tasks', c.taskId, newTasks))
        await requireChild(s.conversationInput, eq(s.conversationInput.id, id(c.id)), `conversation_input:${c.id}`, { taskId: id(c.taskId), sourceTaskId: id(c.sourceTaskId), weight: c.weight, mode: c.mode,
          snapshotId: id(c.snapshotId), selectedBy: userRef(c.selectedBy, `conversation_input:${c.id}.selectedBy`), selectedAt: date(c.selectedAt) })
      for (const a of rows(b, 'activity')) if (a.taskId && skippedParent('tasks', a.taskId, newTasks) || a.srId && skippedParent('serviceRequests', a.srId, newSrs))
        await requireChild(s.activityLog, eq(s.activityLog.id, id(a.id)), `activity_log:${a.id}`, { type: String(a.type), userId: userRef(a.userId, `activity:${a.id}.userId`), taskId: nullableId(a.taskId), assistantId: nullableId(a.assistantId),
          srId: nullableId(a.srId), payload: a.payload ?? {}, at: date(a.at) })
      for (const t of rows(b, 'tasks')) if (!newTasks.has(id(t.id))) {
        for (const userId of t.assigneeIds ?? []) await requireChild(s.taskAssignee,
          sql`${s.taskAssignee.taskId} = ${id(t.id)} and ${s.taskAssignee.userId} = ${id(userId)}`, `task_assignee:${t.id}/${userId}`, { taskId: id(t.id), userId: id(userId) })
        for (const tag of taskTags(t)) await requireChild(s.taskTag,
          sql`${s.taskTag.taskId} = ${id(t.id)} and ${s.taskTag.tagKey} = ${String(tag)}`, `task_tag:${t.id}/${tag}`, { taskId: id(t.id), tagKey: String(tag), addedBy: userRef(t.createdBy, `task:${t.id}.createdBy`), addedAt: date(t.createdAt) })
        for (const [sortOrder, input] of (t.inputs ?? []).entries()) await requireChild(s.taskInput,
          sql`${s.taskInput.taskId} = ${id(t.id)} and ${s.taskInput.fileId} = ${id(input.fileId)}`, `task_input:${t.id}/${input.fileId}`, { taskId: id(t.id), fileId: id(input.fileId),
            weight: input.weight ?? 'reference', sortOrder, selectedBy: userRef(input.selectedBy || t.createdBy, `task:${t.id}.inputs.selectedBy`), selectedAt: date(input.selectedAt ?? t.createdAt) })
        for (const [sortOrder, item] of (t.checklist ?? []).entries()) await requireChild(s.checklistItem, eq(s.checklistItem.id, id(item.id)), `checklist_item:${item.id}`,
          { taskId: id(t.id), sortOrder, label: String(item.label), required: !!item.required, checked: !!item.checked, checkedBy: userRef(item.checkedBy, `checklist_item:${item.id}.checkedBy`, true), checkedAt: date(item.checkedAt) ?? null })
        if (t.feedback) await requireChild(s.taskFeedback, eq(s.taskFeedback.taskId, id(t.id)), `task_feedback:${t.id}`,
          { taskId: id(t.id), rating: Number(t.feedback.rating), comment: String(t.feedback.comment ?? ''), byUser: userRef(t.feedback.by, `task_feedback:${t.id}.by`), at: date(t.feedback.at) })
        if (t.checklistReview) {
          const reviewId = `${t.id}:import-review`
          await requireChild(s.checklistReview, eq(s.checklistReview.id, reviewId), `checklist_review:${reviewId}`,
            { taskId: id(t.id), byUser: userRef(t.checklistReview.by, `checklist_review:${reviewId}.by`), at: date(t.checklistReview.at), met: t.checklistReview.met, total: t.checklistReview.total, source: t.checklistReview.source })
          for (const item of t.checklistReview.items ?? []) await requireChild(s.checklistReviewItem,
            sql`${s.checklistReviewItem.reviewId} = ${reviewId} and ${s.checklistReviewItem.itemId} = ${id(item.itemId)}`, `checklist_review_item:${reviewId}/${item.itemId}`,
            { reviewId, itemId: id(item.itemId), met: !!item.met, note: String(item.note ?? '') })
        }
      }
      for (const m of rows(b, 'messages')) if (!newMessages.has(id(m.id))) for (const fileId of m.attachmentIds ?? [])
        await requireChild(s.messageAttachment, sql`${s.messageAttachment.messageId} = ${id(m.id)} and ${s.messageAttachment.fileId} = ${id(fileId)}`, `message_attachment:${m.id}/${fileId}`,
          { messageId: id(m.id), fileId: id(fileId) })
      for (const n of rows(b, 'notes')) if (!newNotes.has(id(n.id))) for (const fileId of n.attachmentIds ?? [])
        await requireChild(s.noteAttachment, sql`${s.noteAttachment.noteId} = ${id(n.id)} and ${s.noteAttachment.fileId} = ${id(fileId)}`, `note_attachment:${n.id}/${fileId}`,
          { noteId: id(n.id), fileId: id(fileId) })
      for (const snap of rows(b, 'contextSnapshots')) if (!newSnapshots.has(id(snap.id))) for (const messageId of snap.messageIds ?? [])
        await requireChild(s.contextSnapshotMessage, sql`${s.contextSnapshotMessage.snapshotId} = ${id(snap.id)} and ${s.contextSnapshotMessage.messageId} = ${id(messageId)}`, `context_snapshot_message:${snap.id}/${messageId}`,
          { snapshotId: id(snap.id), messageId: id(messageId), seq: (snap.messageIds ?? []).indexOf(messageId) })
      for (const sr of rows(b, 'serviceRequests')) if (!newSrs.has(id(sr.id))) {
        for (const result of sr.results ?? []) {
          await requireChild(s.sharedResult, eq(s.sharedResult.id, id(result.id)), `shared_result:${result.id}`,
            { srId: id(sr.id), taskId: nullableId(result.taskId), text: String(result.text ?? ''), byUser: userRef(result.by, `shared_result:${result.id}.by`), at: date(result.at) })
          for (const fileId of result.fileIds ?? []) await requireChild(s.sharedResultFile,
            sql`${s.sharedResultFile.resultId} = ${id(result.id)} and ${s.sharedResultFile.fileId} = ${id(fileId)}`, `shared_result_file:${result.id}/${fileId}`,
            { resultId: id(result.id), fileId: id(fileId) })
        }
        if ((sr.attachmentIds ?? []).length) {
          const srThread = rows(b, 'threads').find((th) => th.srId === sr.id)
          const [firstUser] = srThread ? await tx.select().from(s.message).where(sql`${s.message.threadId} = ${id(srThread.id)} and ${s.message.role} = 'user'`).orderBy(s.message.seq).limit(1) : []
          for (const fileId of sr.attachmentIds) {
            if (!firstUser) missing.push(`message_attachment:${sr.id}/${fileId}`)
            else await requireChild(s.messageAttachment,
              sql`${s.messageAttachment.messageId} = ${firstUser.id} and ${s.messageAttachment.fileId} = ${id(fileId)}`, `message_attachment:${firstUser.id}/${fileId}`,
              { messageId: firstUser.id, fileId: id(fileId) })
          }
        }
      }
      const handled = new Set(['users', 'assistants', 'serviceRequests', 'tasks', 'threads', 'messages', 'files', 'notes', 'activity', 'notifications', 'settings', 'conversationInputs', 'contextSnapshots', 'packages', 'packageReceipts'])
      for (const name of Object.keys(b.tables)) if (!handled.has(name)) skip(name, '—', '서버 대응 없음')
      if (conflicts.length) throw new Error(`ID 충돌: ${[...new Set(conflicts)].join(', ')}`)
      if (missing.length) throw new Error(`누락된 하위 행: ${[...new Set(missing)].join(', ')}`)
      if (dryRun) throw new DryRunComplete()
    })
  } catch (error) {
    if (!(error instanceof DryRunComplete)) {
      for (const key of written.reverse()) await storage!.remove(key)
      throw error
    }
  }
  return { report, codeMappings, credentials }
}

class DryRunComplete extends Error {}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  async function main() {
    const args = process.argv.slice(2)
    const files: string[] = []
    let dryRun = false
    let allowMultiSr = false
    let defaultOwner: string | undefined
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!
      if (arg === '--dry-run') dryRun = true
      else if (arg === '--allow-multi-sr') allowMultiSr = true
      else if (arg === '--default-owner' && args[i + 1] && !args[i + 1]!.startsWith('--')) defaultOwner = args[++i]
      else files.push(arg)
    }
    const [file] = files
    if (files.length !== 1 || file!.startsWith('--')) throw new Error('사용법: db:import <bundle.json> [--dry-run] [--default-owner <loginId>] [--allow-multi-sr]')
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다')
    const maxBytes = Number(process.env.IMPORT_BUNDLE_MAX_BYTES ?? DEFAULT_IMPORT_BUNDLE_MAX_BYTES)
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('IMPORT_BUNDLE_MAX_BYTES는 양의 정수여야 합니다')
    if ((await stat(resolve(file))).size > maxBytes) throw new Error(`bundle 크기가 제한(${maxBytes} bytes)을 초과합니다`)
    const source = await readFile(resolve(file))
    if (source.byteLength > maxBytes) throw new Error(`bundle 크기가 제한(${maxBytes} bytes)을 초과합니다`)
    const input = JSON.parse(source.toString('utf8')) as unknown
    const client = createPool(process.env.DATABASE_URL)
    try {
      const storage = dryRun ? undefined : new FileStorageService(resolve(process.env.FILE_STORAGE_ROOT ?? 'storage'))
      const result = await importBundle(input, drizzle(client), storage, dryRun, { defaultOwner, allowMultiSr })
      for (const [name, counts] of Object.entries(result.report)) console.log(`${name}: 가져올 ${counts.imported}, 건너뛸 ${counts.skipped}${counts.reason ? ` (${counts.reason})` : ''}`)
      for (const entry of result.codeMappings) console.log(`${entry.kind} 번호: ${entry.from} → ${entry.to} (${entry.id})`)
      for (const entry of result.credentials) console.log(`${entry.loginId}\t${entry.password}`)
    } finally { await client.end() }
  }
  main().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error)
    const message = /^Failed query:|\b(?:insert|select|update|delete)\s+into\b/i.test(detail) || (error && typeof error === 'object' && 'sql' in error)
      ? 'DB 처리에 실패했습니다' : detail.split(/\r?\n/, 1)[0] || '가져오기에 실패했습니다'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
