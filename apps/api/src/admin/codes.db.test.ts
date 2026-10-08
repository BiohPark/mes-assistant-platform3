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

it('같은 요청의 ID는 이름보다 우선하며 ID 분류 변경도 자동 코드를 정리한다', async () => {
  const manual = await admin.createCode({ groupKey: 'assistant_level1', code: 'KEEP', name: '수동 유지' })
  const selected = await admin.createAssistant('owner', { ...input('무시할 이름'), level1CodeId: manual!.id })
  expect(selected.level1CodeId).toBe(manual!.id)
  expect(await rows('assistant_level1:무시할 이름')).toEqual([])
  await admin.deleteAssistant(selected.id)
  const created = await admin.createAssistant('owner', input('ID 변경 전'))
  await admin.updateAssistant(created.id, { level1CodeId: manual!.id })
  expect(await rows(created.level1CodeId)).toEqual([])
  await admin.deleteAssistant(created.id)
  expect(await rows(manual!.id)).toHaveLength(1)
})

it.each(['assistant_level1', 'assistant_level2'])('기존 이름이 모호해도 %s ID 참조를 보존하고 이름 조회는 409로 거부한다', async group => {
  const field = group === 'assistant_level1' ? 'level1' : 'level2'
  const idField = `${field}CodeId` as const
  const created = await admin.createAssistant('owner', input('Café Ambiguous', 'Café Ambiguous'))
  const duplicate = `${group}:AMBIGUOUS`
  await db.insert(code).values({ id: duplicate, groupKey: group, code: 'AMBIGUOUS', name: ' cafe\u0301   ambiguous ', active: false })
  await admin.updateAssistant(created.id, { summary: '설명 수정', [field]: 'café ambiguous', [idField]: created[idField] })
  expect(await admin.assistant(created.id)).toMatchObject({ summary: '설명 수정', [idField]: created[idField] })
  expect(await rows(created[idField])).toHaveLength(1)
  await expect(admin.createAssistant('owner', { ...input('모호한 요청', '모호한 요청'), [field]: 'CAFÉ AMBIGUOUS' })).rejects.toMatchObject({ status: 409 })
  await expect(admin.updateAssistant(created.id, { [field]: 'CAFÉ AMBIGUOUS' })).rejects.toMatchObject({ status: 409 })
  expect((await admin.assistant(created.id))[idField]).toBe(created[idField])
  await admin.deleteAssistant(created.id)
  await db.delete(code).where(eq(code.id, duplicate))
})

it('수동 생성과 SO 이름 변경은 비활성 행까지 정규화 이름 충돌을 거부하고 그룹·자기 행은 구분한다', async () => {
  const existing = await admin.createCode({ groupKey: 'assistant_level1', code: 'COLLISION', name: 'Café Collision' })
  await admin.updateCode(existing!.id, { active: false })
  await expect(admin.createCode({ groupKey: 'assistant_level1', code: 'OTHER', name: '  CAFE\u0301   collision ' })).rejects.toMatchObject({ status: 409 })
  expect(await rows('assistant_level1:OTHER')).toEqual([])
  const created = await admin.createAssistant('owner', input('자동 이름 변경'))
  await expect(admin.updateCode(created.level1CodeId, { name: ' cafe\u0301 COLLISION ', sortOrder: 9 })).rejects.toMatchObject({ status: 409 })
  expect(await rows(created.level1CodeId)).toMatchObject([{ name: '자동 이름 변경', sortOrder: 0 }])
  expect((await admin.assistant(created.id)).level1CodeId).toBe(created.level1CodeId)
  await admin.updateCode(existing!.id, { name: ' café   collision ' })
  expect(await rows(existing!.id)).toMatchObject([{ name: ' café   collision ' }])
  const otherGroup = await admin.createCode({ groupKey: 'assistant_level2', code: 'COLLISION', name: 'CAFÉ COLLISION' })
  expect(otherGroup!.groupKey).toBe('assistant_level2')
  await admin.deleteAssistant(created.id)
})

it('이름만 지정한 생성·수정은 여러 정규화 일치 행을 첫 행으로 선택하지 않는다', async () => {
  const created = await admin.createAssistant('owner', input('모호성 원본'))
  const duplicates = ['ONE', 'TWO'].map((key, index) => ({ id: `assistant_level1:${key}`, groupKey: 'assistant_level1', code: key,
    name: index === 0 ? 'Duplicate Name' : ' duplicate   NAME ' }))
  await db.insert(code).values(duplicates)
  await expect(admin.createAssistant('owner', input('DUPLICATE NAME'))).rejects.toMatchObject({ status: 409 })
  await expect(admin.updateAssistant(created.id, { level1: 'DUPLICATE NAME' })).rejects.toMatchObject({ status: 409 })
  expect((await admin.assistant(created.id)).level1CodeId).toBe(created.level1CodeId)
  await admin.deleteAssistant(created.id)
  for (const row of duplicates) await db.delete(code).where(eq(code.id, row.id))
})

it('SO 이름 변경 충돌은 다른 필드와 기존 참조를 함께 롤백한다', async () => {
  const manual = await admin.createCode({ groupKey: 'assistant_level1', code: 'RENAME_CONFLICT', name: 'Rename Conflict' })
  const created = await admin.createAssistant('owner', input('이름 변경 전'))
  await expect(admin.updateCode(created.level1CodeId, { name: ' rename   CONFLICT ', active: false, sortOrder: 8 })).rejects.toMatchObject({ status: 409 })
  expect(await rows(created.level1CodeId)).toMatchObject([{ name: '이름 변경 전', active: true, sortOrder: 0 }])
  expect((await admin.assistant(created.id)).level1CodeId).toBe(created.level1CodeId)
  expect(await rows(manual!.id)).toHaveLength(1)
  await admin.deleteAssistant(created.id)
})

it.each(['create', 'rename'])('동시 %s는 공통 코드 잠금 안에서 이름 충돌을 거부한다', async operation => {
  const name = `Concurrent ${operation}`
  const inputs = ['LEFT', 'RIGHT'].map(key => ({ groupKey: 'assistant_level1', code: `${operation}-${key}`, name: `${operation}-${key}` }))
  const targets = operation === 'rename' ? await Promise.all(inputs.map(item => admin.createCode(item))) : []
  const results = await Promise.allSettled(inputs.map((item, index) => operation === 'create'
    ? admin.createCode({ ...item, name: index === 0 ? name : ` ${name.toUpperCase()} ` })
    : admin.updateCode(targets[index]!.id, { name: index === 0 ? name : ` ${name.toUpperCase()} ` })))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { status: 409 } }])
})

it('접미사 생성도 191자 ID 한도를 지키며 원래 이름을 보존한다', async () => {
  const name = 'y'.repeat(174)
  const original = await admin.createAssistant('owner', input(name))
  await admin.updateCode(original.level1CodeId, { name: '긴 이름 변경' })
  const created = await admin.createAssistant('owner', input(name))
  expect(created.level1CodeId).toBe(`assistant_level1:${'y'.repeat(172)}-1`)
  expect(created.level1CodeId).toHaveLength(191)
  expect(await rows(created.level1CodeId)).toMatchObject([{ name, isAuto: true }])
  await admin.deleteAssistant(original.id)
  await admin.deleteAssistant(created.id)
})

it('SO 이름 변경 뒤 옛 이름은 기존 ID·참조를 보존하며 사용 중인 키를 피해 자동 생성한다', async () => {
  const original = await admin.createAssistant('owner', input('Old Name'))
  await admin.updateCode(original.level1CodeId, { name: 'Renamed' })
  const occupied = await admin.createCode({ groupKey: 'assistant_level1', code: 'Old Name-1', name: '접미사도 사용 중' })
  const created = await admin.createAssistant('owner', input('Old Name'))
  expect(created.level1CodeId).toBe('assistant_level1:Old Name-2')
  expect(await rows(created.level1CodeId)).toMatchObject([{ code: 'Old Name-2', name: 'Old Name', isAuto: true }])
  expect(await rows(original.level1CodeId)).toMatchObject([{ code: 'Old Name', name: 'Renamed' }])
  expect((await admin.assistant(original.id)).level1CodeId).toBe(original.level1CodeId)
  const reused = await admin.createAssistant('owner', input(' old   NAME '))
  expect(reused.level1CodeId).toBe(created.level1CodeId)
  await admin.deleteAssistant(original.id)
  await admin.deleteAssistant(created.id)
  expect(await rows(reused.level1CodeId)).toHaveLength(1)
  await admin.deleteAssistant(reused.id)
  expect(await rows(reused.level1CodeId)).toEqual([])
  expect(await rows(occupied!.id)).toHaveLength(1)
})

it('자동 코드 정리와 순서 저장이 a·z 행에 겹쳐도 교착 없이 수정 완료·순서 충돌 409로 끝난다', async () => {
  const a = await admin.createAssistant('owner', { ...input('교착 공유'), id: 'a' })
  const z = await admin.createAssistant('owner', { ...input('교착 공유'), id: 'z' })
  let paused!: () => void
  let release!: () => void
  const ready = new Promise<void>(resolve => { paused = resolve })
  const hold = new Promise<void>(resolve => { release = resolve })
  const pausedDb = new Proxy(db, {
    get(target, property) {
      if (property !== 'transaction') return Reflect.get(target, property)
      return (callback: Parameters<Db['transaction']>[0]) => target.transaction(async tx => callback(new Proxy(tx, {
        get(targetTx, txProperty) {
          if (txProperty !== 'update') return Reflect.get(targetTx, txProperty)
          return (table: typeof assistant) => {
            const builder = targetTx.update(table)
            if (table !== assistant) return builder
            return { set: (values: Parameters<typeof builder.set>[0]) => ({ where: async (condition: Parameters<ReturnType<typeof builder.set>['where']>[0]) => {
              const result = await builder.set(values).where(condition)
              paused()
              await hold
              return result
            } }) }
          }
        },
      })))
    },
  })
  const updating = new AdminService(pausedDb).updateAssistant('z', { level1: '교착 새 분류' })
    .then(() => null, (error: unknown) => error)
  await ready
  const ordering = admin.order(['z', 'a'], { a: a.revision, z: z.revision }).then(() => null, (error: unknown) => error)
  const probe = await client.getConnection()
  let aLocked = false
  try {
    const deadline = Date.now() + 5_000
    while (!aLocked && Date.now() < deadline) {
      await probe.beginTransaction()
      try { await probe.query("select id from assistant where id = 'a' for update nowait") }
      catch (error) {
        if ((error as { errno?: number }).errno !== 1205) throw error
        aLocked = true
      } finally { await probe.rollback() }
      if (!aLocked) await new Promise(resolve => setTimeout(resolve, 10))
    }
  } finally { probe.release(); release() }
  const [updateError, orderError] = await Promise.all([updating, ordering])
  expect(aLocked).toBe(true)
  expect(updateError).toBeNull()
  expect(orderError).toMatchObject({ status: 409 })
  expect((await admin.assistant('z')).level1CodeId).toBe('assistant_level1:교착 새 분류')
  expect((await admin.assistant('a')).level1CodeId).toBe(a.level1CodeId)
  expect(await rows(a.level1CodeId)).toHaveLength(1)
  const current = await admin.assistant('z')
  await admin.order(['z', 'a'], { a: a.revision, z: current.revision })
  expect(await admin.assistant('z')).toMatchObject({ sortOrder: 1 })
  expect(await admin.assistant('a')).toMatchObject({ sortOrder: 2 })
  await admin.deleteAssistant('a')
  await admin.deleteAssistant('z')
})
