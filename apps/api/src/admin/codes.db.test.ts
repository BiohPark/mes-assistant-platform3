import { readFile } from 'node:fs/promises'
import { drizzle } from 'drizzle-orm/mysql2'
import { eq } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createPool } from '../db/connection.js'
import type { Db } from '../db/db.module.js'
import { runMigrations } from '../db/migrate.js'
import { createTempDb } from '../test/tempDb.js'
import { appUser, assistant, code, codeGroup } from '../db/schema.js'
import { AdminService } from './admin.service.js'

let temp: Awaited<ReturnType<typeof createTempDb>>
let client: Pool
let db: Db
let admin: AdminService
const input = (level1: string, level2 = '공통') => ({ name: '도우미', level1, level2, summary: '', ownerId: 'owner',
  status: 'open' as const, usageExample: '', expectedInputs: [], expectedOutputs: [], checklistTemplate: [] })
const rows = (id: string) => db.select().from(code).where(eq(code.id, id))
beforeAll(async () => {
  temp = await createTempDb('codes')
  await runMigrations(temp.url)
  client = createPool(temp.url)
  db = drizzle(client)
  admin = new AdminService(db)
  await db.insert(codeGroup).values(['assistant_level1', 'assistant_level2'].map(key => ({ key, name: key })))
  await db.insert(appUser).values({ id: 'owner', name: '운영자', initials: '운', color: '#123456' })
})
afterAll(async () => { await client?.end(); await temp?.drop() })

it('기존 행은 수동 코드이며 정규화 이름으로 재사용·재활성하고 ID 입력도 유지한다', async () => {
  const manual = await admin.createCode({ groupKey: 'assistant_level1', code: 'LEGACY', name: '  Cafe\u0301   TOOL ', sortOrder: 7 })
  await admin.updateCode(manual!.id, { active: false })
  const created = await admin.createAssistant('owner', input('café tool'))
  expect(created.level1CodeId).toBe(manual!.id)
  expect(await rows(manual!.id)).toMatchObject([{ isAuto: false, active: true, sortOrder: 7 }])
  const legacy = await admin.createAssistant('owner', { ...input('ignored'), level1: undefined, level2: undefined,
    level1CodeId: manual!.id, level2CodeId: created.level2CodeId })
  await admin.deleteAssistant(created.id)
  await admin.deleteAssistant(legacy.id)
  expect(await rows(manual!.id)).toHaveLength(1)
  expect(await rows(created.level2CodeId)).toEqual([])
})

it('자동 생성은 공백·NFC를 정규화하며 그룹을 분리하고 마지막 참조 해제에만 정리한다', async () => {
  const first = await admin.createAssistant('owner', input('  새\t 분류  ', '새 분류'))
  const shared = await admin.createAssistant('owner', input('새 분류', '새 분류'))
  expect(first.level1CodeId).toBe('assistant_level1:새 분류')
  expect(first.level2CodeId).toBe('assistant_level2:새 분류')
  expect(await rows(first.level1CodeId)).toMatchObject([{ code: '새 분류', name: '새 분류', isAuto: true }])
  await admin.updateAssistant(first.id, { level1: '변경', level2: '변경' })
  expect(await rows(shared.level1CodeId)).toHaveLength(1)
  await admin.deleteAssistant(shared.id)
  expect(await rows(shared.level1CodeId)).toEqual([])
  expect(await rows(shared.level2CodeId)).toEqual([])
  await admin.deleteAssistant(first.id)
  expect(await rows('assistant_level1:변경')).toEqual([])
  expect(await rows('assistant_level2:변경')).toEqual([])
})

it('동시 대소문자·NFC 변형 생성은 같은 코드에 모이며 동시 삭제도 고아를 남기지 않는다', async () => {
  const variants = ['Café Race', 'cafe\u0301   race', ' CAFÉ RACE ']
  const created = await Promise.all(Array.from({ length: 9 }, (_, index) => admin.createAssistant('owner', input(variants[index % 3]!))))
  expect(new Set(created.map(row => row.level1CodeId)).size).toBe(1)
  expect(new Set(created.map(row => row.level2CodeId)).size).toBe(1)
  await Promise.all(created.map(row => admin.deleteAssistant(row.id)))
  expect(await rows(created[0]!.level1CodeId)).toEqual([])
  expect(await rows(created[0]!.level2CodeId)).toEqual([])
})

it('생성·수정 실패는 코드 생성과 재활성·이전 코드 삭제까지 롤백한다', async () => {
  const manual = await admin.createCode({ groupKey: 'assistant_level1', code: 'ROLLBACK', name: '롤백', sortOrder: 2 })
  await admin.updateCode(manual!.id, { active: false })
  await expect(admin.createAssistant('owner', { ...input('롤백', '실패 신규'), ownerId: 'missing' })).rejects.toMatchObject({ status: 400 })
  expect(await rows(manual!.id)).toMatchObject([{ active: false }])
  expect(await rows('assistant_level2:실패 신규')).toEqual([])
  const created = await admin.createAssistant('owner', input('원래', '원래'))
  await expect(admin.updateAssistant(created.id, { level1: '수정 실패', ownerId: 'missing' })).rejects.toMatchObject({ status: 400 })
  expect((await admin.assistant(created.id)).level1CodeId).toBe(created.level1CodeId)
  expect(await rows(created.level1CodeId)).toHaveLength(1)
  expect(await rows('assistant_level1:수정 실패')).toEqual([])
  await admin.deleteAssistant(created.id)
})

it('빈 이름·생성 ID 길이 초과는 DB 오류 없이 거부하며 기존 긴 이름은 재사용한다', async () => {
  for (const name of [' \t ', 'x'.repeat(175)]) await expect(admin.createAssistant('owner', input(name))).rejects.toMatchObject({ status: 400 })
  const manual = await admin.createCode({ groupKey: 'assistant_level1', code: 'LONG', name: 'x'.repeat(191) })
  const created = await admin.createAssistant('owner', input('x'.repeat(191)))
  expect(created.level1CodeId).toBe(manual!.id)
  await admin.deleteAssistant(created.id)
  expect(await rows(manual!.id)).toHaveLength(1)
  expect(await db.select().from(assistant)).toEqual([])
})

it('마이그레이션은 이미 저장된 코드도 is_auto=false로 보존한다', async () => {
  const old = await createTempDb('codes_old')
  const connection = createPool(old.url, 1)
  try {
    const ddl = await readFile(new URL('../../drizzle/0000_gray_sheva_callister.sql', import.meta.url), 'utf8')
    for (const statement of ddl.split('--> statement-breakpoint')) if (statement.trim()) await connection.query(statement)
    await connection.query("insert into code_group (`key`, name) values ('assistant_level1', '분류 1')")
    await connection.query("insert into code (id, group_key, code, name) values ('old', 'assistant_level1', 'OLD', '기존')")
    await connection.query(await readFile(new URL('../../drizzle/0005_panoramic_morgan_stark.sql', import.meta.url), 'utf8'))
    const migrated = drizzle(connection)
    expect(await migrated.select().from(code)).toMatchObject([{ id: 'old', isAuto: false }])
  } finally { await connection.end(); await old.drop() }
})

it('중복 키가 발생하면 잠금 재조회로 승자의 코드를 재사용한다', async () => {
  let injected = false
  const racingDb = new Proxy(db, {
    get(target, property) {
      if (property !== 'transaction') return Reflect.get(target, property)
      return (callback: Parameters<Db['transaction']>[0]) => target.transaction(async tx => {
        const racingTx = new Proxy(tx, {
          get(targetTx, txProperty) {
            if (txProperty !== 'insert') return Reflect.get(targetTx, txProperty)
            return (table: typeof code) => {
              const builder = targetTx.insert(table)
              if (table !== code) return builder
              return { values: async (data: typeof code.$inferInsert) => {
                // 조회 이후 다른 작성자가 같은 행을 만든 상황을 실제 중복 INSERT로 재현한다.
                if (!injected) { injected = true; await builder.values(data) }
                return builder.values(data)
              } }
            }
          },
        })
        return callback(racingTx)
      })
    },
  })
  const created = await new AdminService(racingDb).createAssistant('owner', input('경합 재조회', '경합 재조회'))
  expect(injected).toBe(true)
  expect(await rows(created.level1CodeId)).toMatchObject([{ name: '경합 재조회', isAuto: true }])
  await admin.deleteAssistant(created.id)
})

it('같은 요청의 이름은 전환 기간 ID보다 우선하며 ID 분류 변경도 자동 코드를 정리한다', async () => {
  const manual = await admin.createCode({ groupKey: 'assistant_level1', code: 'KEEP', name: '수동 유지' })
  const created = await admin.createAssistant('owner', { ...input('이름 우선'), level1CodeId: manual!.id })
  expect(created.level1CodeId).toBe('assistant_level1:이름 우선')
  await admin.updateAssistant(created.id, { level1CodeId: manual!.id })
  expect(await rows(created.level1CodeId)).toEqual([])
  await admin.deleteAssistant(created.id)
  expect(await rows(manual!.id)).toHaveLength(1)
})
