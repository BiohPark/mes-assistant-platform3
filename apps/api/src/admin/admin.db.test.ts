import { drizzle } from 'drizzle-orm/mysql2'
import type { Pool } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPool } from '../db/connection.js'
import type { Db } from '../db/db.module.js'
import { appSetting, appUser } from '../db/schema.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { createTempDb } from '../test/tempDb.js'
import { AdminService } from './admin.service.js'
import { AccountsService } from './accounts.service.js'
import { activityLog, appSession, assistant, assistantChecklistTemplate, assistantExpectedIo, code, fileObject, task } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { DbSessionStore } from '../auth/session.service.js'
import { loadConfig } from '../config/config.js'
import { DbLlmPorts } from '../llm/dbLlmPorts.js'

describe('SR 접수 에이전트 보호 (데모 테스트 4건)', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  let db: Db
  let admin: AdminService

  beforeAll(async () => {
    temp = await createTempDb('admin')
    await runMigrations(temp.url)
    client = createPool(temp.url)
    db = drizzle(client)
    await seedCatalog(db)
    await db.insert(appUser).values({ id: 'owner', name: '운영자', initials: '운', color: '#123456', isSystemOwner: true })
    admin = new AdminService(db)
    await admin.settings({ srIntakeAssistantId: 'urs-analyst' })
  })
  afterAll(async () => { await client?.end(); await temp?.drop() })

  it('ID 없는 동시 생성은 짧고 고유한 서버 ID를 만들고 수정 후 유지한다', async () => {
    const input = { name: '자동 ID', level1CodeId: 'assistant_level1:SDLC', level2CodeId: 'assistant_level2:분석',
      summary: '', ownerId: 'owner', status: 'open' as const, usageExample: '', expectedInputs: ['입력'], expectedOutputs: [], checklistTemplate: [] }
    const created = await Promise.all(Array.from({ length: 12 }, () => admin.createAssistant('owner', input)))
    expect(new Set(created.map((row) => row.id)).size).toBe(12)
    for (const row of created) {
      expect(row.id).toMatch(/^a-[a-f0-9]{12}$/)
      expect(await db.select().from(assistantExpectedIo).where(eq(assistantExpectedIo.assistantId, row.id))).toMatchObject([{ label: '입력' }])
      expect((await admin.updateAssistant(row.id, { name: '수정' })).id).toBe(row.id)
      await admin.deleteAssistant(row.id)
    }
    expect((await admin.updateAssistant('urs-analyst-basic', { summary: '기존 ID 유지' })).id).toBe('urs-analyst-basic')
  })
  it('명시한 기존 ID의 중복 생성은 덮어쓰지 않고 충돌로 거부한다', async () => {
    await expect(admin.createAssistant('owner', { id: 'urs-analyst-basic', name: '중복', level1CodeId: 'assistant_level1:SDLC', level2CodeId: 'assistant_level2:분석',
      summary: '', ownerId: 'owner', status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [], checklistTemplate: [] })).rejects.toMatchObject({ status: 409 })
    expect((await admin.assistant('urs-analyst-basic')).name).not.toBe('중복')
  })
  it('refuses to retire the current intake assistant', async () => {
    await expect(admin.updateAssistant('urs-analyst', { status: 'retired' })).rejects.toMatchObject({ status: 409 })
    expect((await admin.assistant('urs-analyst')).status).not.toBe('retired')
  })
  it('refuses to delete the current intake assistant', async () => {
    await expect(admin.deleteAssistant('urs-analyst')).rejects.toMatchObject({ status: 409 })
  })
  it('활동 이력의 에이전트 참조를 지우는 삭제를 거부한다', async () => {
    await admin.createAssistant('owner', { id: 'audit-only', name: '감사 대상', level1CodeId: 'assistant_level1:SDLC', level2CodeId: 'assistant_level2:분석',
      summary: '', ownerId: 'owner', status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [], checklistTemplate: [] })
    await db.insert(activityLog).values({ id: 'audit-only-event', type: 'assistant.created', userId: 'owner', assistantId: 'audit-only', payload: {} })
    await expect(admin.deleteAssistant('audit-only')).rejects.toMatchObject({ status: 409 })
    expect((await db.select({ assistantId: activityLog.assistantId }).from(activityLog).where(eq(activityLog.id, 'audit-only-event')))[0]?.assistantId).toBe('audit-only')
    await db.delete(activityLog).where(eq(activityLog.id, 'audit-only-event'))
    await admin.deleteAssistant('audit-only')
  })
  it('allows retire after reassigning intake', async () => {
    await admin.settings({ srIntakeAssistantId: 'urs-analyst-basic' })
    await admin.updateAssistant('urs-analyst', { status: 'retired' })
    expect((await admin.assistant('urs-analyst')).status).toBe('retired')
  })
  it('refuses to set a retired assistant as intake', async () => {
    await expect(admin.settings({ srIntakeAssistantId: 'urs-analyst' })).rejects.toMatchObject({ status: 409 })
  })
  it('clears intake assistant by deleting the setting', async () => {
    expect(await admin.settings({ srIntakeAssistantId: null })).not.toHaveProperty('srIntakeAssistantId')
    expect(await admin.getSettings()).not.toHaveProperty('srIntakeAssistantId')
    expect(await admin.settings({ srIntakeAssistantId: 'urs-analyst-basic' })).toMatchObject({ srIntakeAssistantId: 'urs-analyst-basic' })
  })
  it('전달 방식·요청 한도를 LLM 포트에 반영하고, 기본 모델은 .env 유효값이며 구형 DB 행은 읽기 DTO에서도 숨긴다 (S7 C2)', async () => {
    await admin.settings({ fileDelivery: 'inline', requestBudgetBytes: 8192, fileMaxPerRequest: 3, link1Rule: 'https://example.test/?model={modelId}' })
    await db.insert(appSetting).values({ key: 'defaultModel', value: 'db-model' }).onDuplicateKeyUpdate({ set: { value: 'db-model' } })
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', AUTH_MODE: 'local', LLM_DEFAULT_MODEL: 'env-model' })
    const settings = await new DbLlmPorts(db, config, 'owner').getSettings()
    expect(settings.llm.model).toBe('env-model')
    expect(settings.llm.fileDelivery).toBe('inline')
    expect(settings.requestBudgetBytes).toBe(8192)
    expect(await admin.getSettings()).toMatchObject({ fileMaxPerRequest: 3, link1Rule: 'https://example.test/?model={modelId}' })
    expect(await admin.getSettings()).not.toHaveProperty('defaultModel')
    expect(await db.select().from(appSetting).where(eq(appSetting.key, 'defaultModel'))).toHaveLength(1) // 행은 지우지 않고 무시만 한다
  })
  it('새 에이전트의 입출력·체크리스트를 저장하고 순서 revision 충돌을 거부한다', async () => {
    const input = { id: 'admin-test', name: '관리 테스트', level1CodeId: 'assistant_level1:SDLC', level2CodeId: 'assistant_level2:분석',
      summary: '요약', ownerId: 'owner', status: 'open' as const, usageExample: '예시', expectedInputs: ['입력'], expectedOutputs: ['출력'],
      checklistTemplate: [{ id: 'admin-check', label: '확인', required: true }] }
    const created = await admin.createAssistant('owner', input)
    expect(created.revision).toBe(0)
    expect(await db.select().from(assistantExpectedIo).where(eq(assistantExpectedIo.assistantId, input.id)).orderBy(assistantExpectedIo.direction)).toMatchObject([
      { direction: 'input', label: '입력' }, { direction: 'output', label: '출력' },
    ])
    expect(await db.select().from(assistantChecklistTemplate).where(eq(assistantChecklistTemplate.assistantId, input.id))).toMatchObject([{ label: '확인', required: true }])
    await admin.updateAssistant(input.id, { expectedOutputs: ['새 출력'] })
    expect(await db.select().from(assistantExpectedIo).where(eq(assistantExpectedIo.assistantId, input.id)).orderBy(assistantExpectedIo.direction)).toMatchObject([
      { direction: 'input', label: '입력' }, { direction: 'output', label: '새 출력' },
    ])
    const all = await db.select().from(assistant)
    const revisions = Object.fromEntries(all.map((row) => [row.id, row.revision]))
    await admin.order(all.map((row) => row.id), revisions)
    await expect(admin.order(all.map((row) => row.id), revisions)).rejects.toMatchObject({ status: 409 })
    await admin.deleteAssistant('admin-test')
  })
  it('순서 저장은 잠긴 행의 최신 revision을 확인한다', async () => {
    const rows = await db.select().from(assistant)
    const revisions = Object.fromEntries(rows.map((row) => [row.id, row.revision]))
    let locked!: () => void
    let release!: () => void
    const ready = new Promise<void>((resolve) => { locked = resolve })
    const hold = new Promise<void>((resolve) => { release = resolve })
    const writer = db.transaction(async (tx) => {
      await tx.select().from(assistant).where(eq(assistant.id, 'urs-analyst-basic')).for('update')
      locked()
      await hold
      await tx.update(assistant).set({ revision: revisions['urs-analyst-basic']! + 1 }).where(eq(assistant.id, 'urs-analyst-basic'))
    })
    await ready
    const ordering = admin.order(rows.map((row) => row.id), revisions).then(() => null, (error: unknown) => error)
    try {
      await new Promise((resolve) => setTimeout(resolve, 100))
    } finally { release(); await writer }
    expect(await ordering).toMatchObject({ status: 409 })
  })
  it('대화가 있는 에이전트는 삭제하지 않는다', async () => {
    await db.insert(task).values({ id: 'admin-task', code: 'ADMIN-1', assistantId: 'urs-analyst-basic', title: '대화',
      titleSource: 'manual', status: 'todo', ownerId: 'owner', priority: 'normal', createdBy: 'owner' })
    await expect(admin.deleteAssistant('urs-analyst-basic')).rejects.toMatchObject({ status: 409 })
  })
  it('코드 ID 길이를 API 경계에서 거부하고 비활성 코드는 목록 옵션으로만 조회한다', async () => {
    await expect(admin.createCode({ groupKey: 'assistant_level1', code: 'x'.repeat(191), name: '너무 긺' })).rejects.toMatchObject({ status: 400 })
    const created = await admin.createCode({ groupKey: 'assistant_level1', code: 'ADMIN', name: '관리' })
    await admin.updateCode(created!.id, { active: false })
    expect((await admin.codes('assistant_level1')).some((item) => item.id === created!.id)).toBe(false)
    expect((await admin.codes('assistant_level1', true)).some((item) => item.id === created!.id)).toBe(true)
  })
  it('새 코드 선택은 비활성화와 직렬화된다', async () => {
    const selected = await admin.createCode({ groupKey: 'assistant_level1', code: 'RACE', name: '경쟁 검증' })
    let locked!: () => void
    let release!: () => void
    const ready = new Promise<void>((resolve) => { locked = resolve })
    const hold = new Promise<void>((resolve) => { release = resolve })
    const writer = db.transaction(async (tx) => {
      await tx.select().from(code).where(eq(code.id, selected!.id)).for('update')
      locked()
      await hold
      await tx.update(code).set({ active: false }).where(eq(code.id, selected!.id))
    })
    await ready
    const creating = admin.createAssistant('owner', { id: 'code-race', name: '경쟁 에이전트', level1CodeId: selected!.id,
      level2CodeId: 'assistant_level2:분석', summary: '', ownerId: 'owner', status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [], checklistTemplate: [] }).then(() => null, (error: unknown) => error)
    try {
      await new Promise((resolve) => setTimeout(resolve, 100))
    } finally { release(); await writer }
    expect(await creating).toMatchObject({ status: 400 })
    expect(await db.select().from(assistant).where(eq(assistant.id, 'code-race'))).toEqual([])
  })
  it('비활성 코드는 새 선택을 막고 기존 에이전트의 다른 필드 수정은 허용한다', async () => {
    await db.update(code).set({ active: false }).where(eq(code.id, 'assistant_level2:분석'))
    await expect(admin.createAssistant('owner', { id: 'bad-code', name: '오류', level1CodeId: 'assistant_level1:SDLC', level2CodeId: 'assistant_level2:분석', summary: '', ownerId: 'owner', status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [], checklistTemplate: [] })).rejects.toMatchObject({ status: 400 })
    await admin.updateAssistant('urs-analyst', { summary: '수정' })
    expect((await admin.assistant('urs-analyst')).summary).toBe('수정')
  })
  it('마지막 SO 해제를 막고 임시 비밀번호는 세션을 없애며 변경 후 플래그를 내린다', async () => {
    const accounts = new AccountsService(db)
    await expect(accounts.role('owner', 'isSystemOwner', false)).rejects.toMatchObject({ status: 409 })
    await db.insert(appUser).values({ id: 'member', loginId: 'member', name: '담당자', initials: '담', color: '#111111', passwordHash: await hashPassword('password-1234') })
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', AUTH_MODE: 'local' })
    const sessions = new DbSessionStore(db, config)
    const session = await sessions.create('member')
    const temporary = await accounts.temporaryPassword('member')
    expect(temporary.temporaryPassword).toHaveLength(24)
    expect(await sessions.resolve(session.token)).toBeNull()
    const [member] = await db.select().from(appUser).where(eq(appUser.id, 'member'))
    expect(member?.mustChangePassword).toBe(true)
    expect(await verifyPassword(temporary.temporaryPassword, member!.passwordHash!)).toBe(true)
    await accounts.changePassword('member', temporary.temporaryPassword, 'new-password-1234')
    const [changed] = await db.select().from(appUser).where(eq(appUser.id, 'member'))
    expect(changed?.mustChangePassword).toBe(false)
    expect(await verifyPassword('new-password-1234', changed!.passwordHash!)).toBe(true)
    expect(await db.select().from(appSession).where(eq(appSession.userId, 'member'))).toEqual([])
  })
  it('사용자 이름을 바꾸면 머리글자도 갱신한다', async () => {
    const accounts = new AccountsService(db)
    await accounts.name('member', '김 담당')
    expect((await db.select().from(appUser).where(eq(appUser.id, 'member')))[0]).toMatchObject({ name: '김 담당', initials: '김' })
  })
  it('사용자를 비활성화하면 기존 세션을 없애고 새 세션을 인증하지 않는다', async () => {
    const accounts = new AccountsService(db)
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', AUTH_MODE: 'local' })
    const sessions = new DbSessionStore(db, config)
    const session = await sessions.create('member')
    await accounts.active('member', false)
    expect(await sessions.resolve(session.token)).toBeNull()
    expect(await db.select().from(appSession).where(eq(appSession.userId, 'member'))).toEqual([])
  })
  it('이미지를 교체하면 이전 파일을 소프트 삭제한다', async () => {
    const { FileStorageService } = await import('../files/fileStorage.service.js')
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const root = await mkdtemp(join(tmpdir(), 'admin-image-'))
    const service = new AdminService(db, new FileStorageService(root))
    try {
      const first = await service.image('owner', 'urs-analyst-basic', { originalname: 'one.png', mimetype: 'image/png', buffer: Buffer.from('one'), size: 3 })
      const second = await service.image('owner', 'urs-analyst-basic', { originalname: 'two.png', mimetype: 'image/png', buffer: Buffer.from('two'), size: 3 })
      expect(first.imageFileId).not.toBe(second.imageFileId)
      expect((await db.select().from(fileObject).where(eq(fileObject.id, first.imageFileId!)))[0]?.deletedAt).toBeInstanceOf(Date)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
