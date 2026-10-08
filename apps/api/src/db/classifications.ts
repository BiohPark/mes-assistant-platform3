import { BadRequestException, ConflictException } from '@nestjs/common'
import { ClassificationsInputSchema, type Classification, type ClassificationInput } from '@mes/contracts'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from './db.module.js'
import { assistant, assistantClassification, code } from './schema.js'
import { isDuplicateKey } from './errors.js'

export type ClassificationIds = { level1CodeId: string; level2CodeId: string }
export const normalizeCodeName = (value: string) => value.trim().replace(/\s+/gu, ' ').normalize('NFC')
export async function lockAssistantCodes(tx: Db) {
  await tx.execute(sql`insert into db_lock (lock_key) values ('assistant-codes') on duplicate key update lock_key = lock_key`)
}
export async function resolveCode(tx: Db, group: string, value: string, options: { isAuto?: boolean; sortOrder?: number } = {}) {
  const name = normalizeCodeName(value)
  if (!name || name.length > 191) throw new BadRequestException('분류 이름은 1~191자여야 합니다')
  const find = async () => {
    const rows = await tx.select().from(code).where(eq(code.groupKey, group)).orderBy(asc(code.id)).for('update')
    const matches = rows.filter(row => normalizeCodeName(row.name).toLowerCase() === name.toLowerCase())
    if (matches.length > 1) throw new ConflictException('분류 이름에 해당하는 코드가 여러 개입니다')
    return matches[0]
  }
  let row = await find()
  if (!row) {
    if (`${group}:${name}`.length > 191) throw new BadRequestException('코드 ID는 191자를 넘을 수 없습니다')
    const existing = await tx.select({ id: code.id, key: code.code }).from(code).where(eq(code.groupKey, group)).for('update')
    let key = name
    let index = 0
    while (existing.some(item => item.key === key || item.id === `${group}:${key}`)) {
      const suffix = `-${++index}`
      let end = 191 - group.length - 1 - suffix.length
      // Keep the UTF-16 ID budget without leaving a high surrogate at the cut.
      if (/[\uD800-\uDBFF]/u.test(name.charAt(end - 1)) && /[\uDC00-\uDFFF]/u.test(name.charAt(end))) end--
      key = `${name.slice(0, end)}${suffix}`
    }
    const id = `${group}:${key}`
    try {
      await tx.insert(code).values({ id, groupKey: group, code: key, name, isAuto: options.isAuto ?? true, sortOrder: options.sortOrder ?? 0 })
      return id
    } catch (error) {
      if (!isDuplicateKey(error)) throw error
      row = await find()
      if (!row) throw new ConflictException('이미 존재하는 코드입니다')
    }
  }
  if (!row.active) await tx.update(code).set({ active: true }).where(eq(code.id, row.id))
  return row.id
}

/** Caller holds assistant-codes for the full transaction, including parent insertion. */
export async function resolveClassifications(tx: Db, paths: ClassificationInput[], existing: ClassificationIds[] = []): Promise<ClassificationIds[]> {
  const parsed = ClassificationsInputSchema.safeParse(paths)
  if (!parsed.success) throw new BadRequestException('분류 경로를 하나 이상 올바르게 입력하세요')
  const result: ClassificationIds[] = []
  for (const path of parsed.data) {
    const ids = 'level1CodeId' in path ? path : {
      level1CodeId: await resolveCode(tx, 'assistant_level1', path.level1),
      level2CodeId: await resolveCode(tx, 'assistant_level2', path.level2),
    }
    const keep = 'level1CodeId' in path && existing.some(old => old.level1CodeId === ids.level1CodeId && old.level2CodeId === ids.level2CodeId)
    for (const [id, group] of [[ids.level1CodeId, 'assistant_level1'], [ids.level2CodeId, 'assistant_level2']] as const) {
      const [row] = await tx.select().from(code).where(and(eq(code.id, id), eq(code.groupKey, group))).for('update')
      if (!row || (!keep && !row.active)) throw new BadRequestException('활성 분류 코드를 선택하세요')
    }
    if (result.some(old => old.level1CodeId === ids.level1CodeId && old.level2CodeId === ids.level2CodeId)) throw new BadRequestException('분류 경로가 중복되었습니다')
    result.push(ids)
  }
  return result
}

/** The sole path replacement writer; also synchronizes the legacy representative columns. */
export async function writeClassifications(tx: Db, id: string, paths: ClassificationInput[]): Promise<ClassificationIds[]> {
  await lockAssistantCodes(tx)
  const old = await tx.select().from(assistantClassification).where(eq(assistantClassification.assistantId, id)).orderBy(asc(assistantClassification.sortOrder))
  const resolved = await resolveClassifications(tx, paths, old)
  await tx.delete(assistantClassification).where(eq(assistantClassification.assistantId, id))
  await tx.insert(assistantClassification).values(resolved.map((path, sortOrder) => ({ assistantId: id, ...path, sortOrder })))
  await tx.update(assistant).set(resolved[0]!).where(eq(assistant.id, id))
  return resolved
}

export function classificationView(paths: ClassificationIds[], labels: Map<string, string>): Classification[] {
  if (!paths.length) throw new Error('에이전트 분류 경로 불변식 위반: 경로가 없습니다')
  return paths.map(path => ({ level1CodeId: path.level1CodeId, level2CodeId: path.level2CodeId, level1: labels.get(path.level1CodeId) ?? path.level1CodeId, level2: labels.get(path.level2CodeId) ?? path.level2CodeId }))
}

export async function assertClassificationInvariants(db: Db): Promise<void> {
  const [rows] = await db.execute(sql`select a.id from assistant a
    left join assistant_classification p on p.assistant_id = a.id and p.sort_order = 0
    left join code c1 on c1.id = p.level1_code_id
    left join code c2 on c2.id = p.level2_code_id
    where p.assistant_id is null or a.level1_code_id <> p.level1_code_id or a.level2_code_id <> p.level2_code_id
      or c1.group_key <> 'assistant_level1' or c2.group_key <> 'assistant_level2'
    limit 1`)
  if ((rows as unknown as unknown[]).length) throw new Error('에이전트 분류 경로 불변식 위반: db:migrate 및 대표 경로를 확인하세요')
}
