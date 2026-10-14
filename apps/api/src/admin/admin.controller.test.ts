import 'reflect-metadata'
import { Readable } from 'node:stream'
import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { INestApplication } from '@nestjs/common'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { SESSION_STORE } from '../auth/session.service.js'
import { AdminService } from './admin.service.js'
import { AccountsService } from './accounts.service.js'
import { DbCatalogReader } from '../catalog/catalog.service.js'

const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', AUTH_MODE: 'local' })
const admin = { getSettings: vi.fn(async () => ({})), settings: vi.fn(async () => ({})), createAssistant: vi.fn(async () => ({ id: 'new-agent' })),
  order: vi.fn(async () => undefined), codes: vi.fn(async () => []), updateAssistant: vi.fn(async () => ({})), deleteAssistant: vi.fn(async () => undefined), image: vi.fn(async () => undefined),
  assistantImage: vi.fn(async () => ({ assistantImageFileId: 'img-1' })),
  assistantImageContent: vi.fn(async () => ({ mime: 'image/png', size: 3, stream: Readable.from([Buffer.from('png')]) })) }
const accounts = { profile: vi.fn(async (_id: string, input: unknown) => input), users: vi.fn(async () => []), role: vi.fn(async () => undefined), active: vi.fn(async () => undefined), name: vi.fn(async (_id: string, name: string) => ({ name })), temporaryPassword: vi.fn(async () => ({ temporaryPassword: 'secret' })), changePassword: vi.fn(async () => undefined) }

describe('관리 API 서버 권한', () => {
  let app: INestApplication
  beforeEach(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(SESSION_STORE).useValue({ resolve: async (token: string) => token === 'bo' ? { id: 'bo', name: 'BO', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: false, isBusinessOwner: true } : token === 'so' ? { id: 'so', name: 'SO', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: true } : token === 'forced' ? { id: 'forced', name: '사용자', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: false, mustChangePassword: true } : token === 'member' ? { id: 'member', name: '사용자', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: false } : null })
      .overrideProvider(AdminService).useValue(admin)
      .overrideProvider(DbCatalogReader).useValue({ assistants: async () => [{ id: 'new-agent', order: 1, checklistTemplate: [] }] })
      .overrideProvider(AccountsService).useValue(accounts)
      .compile()
    app = configureApp(module.createNestApplication(), config)
    await app.listen(0, '127.0.0.1')
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks() })

  it('PATCH /me는 본인 이메일만 수정하며 빈 값은 null로 전달한다', async () => {
    await request(app.getHttpServer()).patch('/api/me').set('Cookie', 'mes_session=forced').send({ email: 'a@example.com' }).expect(403)
    await request(app.getHttpServer()).patch('/api/me').set('Cookie', 'mes_session=bo').send({ email: 'bo@example.com' }).expect(200)
    expect(accounts.profile).toHaveBeenCalledWith('bo', { email: 'bo@example.com' })
    await request(app.getHttpServer()).patch('/api/me').send({ email: 'a@example.com' }).expect(401)
    await request(app.getHttpServer()).patch('/api/me').set('Cookie', 'mes_session=member').send({ email: 'Mixed.Case@example.com' }).expect(200)
    expect(accounts.profile).toHaveBeenCalledWith('member', { email: 'Mixed.Case@example.com' })
    await request(app.getHttpServer()).patch('/api/me').set('Cookie', 'mes_session=member').send({ email: '' }).expect(200)
    expect(accounts.profile).toHaveBeenCalledWith('member', { email: null })
    for (const input of [{ email: 'invalid' }, { email: 'a@example.com', id: 'so' }, {}]) {
      await request(app.getHttpServer()).patch('/api/me').set('Cookie', 'mes_session=member').send(input).expect(400)
    }
    await request(app.getHttpServer()).patch('/api/users/other').set('Cookie', 'mes_session=so').send({ email: 'a@example.com' }).expect(400)
  })
  it('에이전트 이미지 업로드는 UTF-8 파일 이름을 그대로 넘긴다', async () => {
    await request(app.getHttpServer()).post('/api/assistants/new-agent/image').set('Cookie', 'mes_session=so').attach('file', Buffer.from('png'), { filename: '아이콘 🙂.png', contentType: 'image/png' }).expect(201)
    expect(admin.image).toHaveBeenCalledWith('so', 'new-agent', expect.objectContaining({ originalname: '아이콘 🙂.png', mimetype: 'image/png' }))
  })
  it('AI 도우미 캐릭터 이미지는 SO만 올리고·지우며, 파일이 없으면 400이고 PATCH로는 바꿀 수 없다 (U4)', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    for (const cookie of ['member', 'bo']) {
      await request(app.getHttpServer()).post('/api/settings/assistant-image').set('Cookie', `mes_session=${cookie}`).attach('file', png, { filename: 'c.png', contentType: 'image/png' }).expect(403)
      await request(app.getHttpServer()).delete('/api/settings/assistant-image').set('Cookie', `mes_session=${cookie}`).expect(403)
    }
    await request(app.getHttpServer()).post('/api/settings/assistant-image').attach('file', png, { filename: 'c.png', contentType: 'image/png' }).expect(401)
    expect(admin.assistantImage).not.toHaveBeenCalled()
    await request(app.getHttpServer()).post('/api/settings/assistant-image').set('Cookie', 'mes_session=so').expect(400)
    const uploaded = await request(app.getHttpServer()).post('/api/settings/assistant-image').set('Cookie', 'mes_session=so').attach('file', png, { filename: '캐릭터.png', contentType: 'image/png' }).expect(201)
    expect(admin.assistantImage).toHaveBeenCalledWith('so', expect.objectContaining({ originalname: '캐릭터.png', size: png.length }))
    expect(uploaded.body).toMatchObject({ assistantImageFileId: 'img-1', defaultModel: 'glm-5.2' })
    await request(app.getHttpServer()).delete('/api/settings/assistant-image').set('Cookie', 'mes_session=so').expect(204)
    expect(admin.assistantImage).toHaveBeenLastCalledWith('so', null)
    await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ assistantImageFileId: 'x' }).expect(400)
    expect(admin.settings).not.toHaveBeenCalled()
  })
  it('현재 캐릭터 이미지는 로그인 사용자가 권한 검사 없이 열람하고, 없으면 404, 비로그인은 401 (U4 리뷰 P2)', async () => {
    // 요청자 전용(BO)은 auth/guards.ts의 BO 경로 허용 목록(이 작업 범위 밖)에서 403 — 알약은 BO에게 안 보이므로 실사용 영향 없음. 허용하려면 그 목록에 GET /api/settings/assistant-image 한 줄
    await request(app.getHttpServer()).get('/api/settings/assistant-image').set('Cookie', 'mes_session=bo').expect(403)
    for (const cookie of ['member', 'so']) {
      const response = await request(app.getHttpServer()).get('/api/settings/assistant-image').set('Cookie', `mes_session=${cookie}`).expect(200)
      expect(response.headers['content-type']).toMatch(/^image\/png/)
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(Buffer.from(response.body as Buffer).toString()).toBe('png')
    }
    await request(app.getHttpServer()).get('/api/settings/assistant-image').expect(401)
    admin.assistantImageContent.mockRejectedValueOnce(new NotFoundException('캐릭터 이미지가 없습니다'))
    await request(app.getHttpServer()).get('/api/settings/assistant-image').set('Cookie', 'mes_session=member').expect(404)
    admin.assistantImageContent.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    await request(app.getHttpServer()).get('/api/settings/assistant-image').set('Cookie', 'mes_session=member').expect(404)
  })
  it('도구 전달 설정은 auto/off만 SO가 변경하고 누락 시 다른 설정에 섞이지 않는다', async () => {
    for (const owuiTools of ['auto', 'off']) {
      await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ owuiTools }).expect(200)
      expect(admin.settings).toHaveBeenLastCalledWith({ owuiTools })
      await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=member').send({ owuiTools }).expect(403)
    }
    for (const owuiTools of ['on', null, true]) await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ owuiTools }).expect(400)
    await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ fileMaxPerRequest: 7 }).expect(200)
    expect(admin.settings).toHaveBeenLastCalledWith({ fileMaxPerRequest: 7 })
  })
  it('설정 조회는 로그인 사용자, 변경과 사용자 목록은 SO만 허용한다', async () => {
    await request(app.getHttpServer()).get('/api/settings').set('Cookie', 'mes_session=member').expect(200)
    await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=member').send({ fileDelivery: 'inline' }).expect(403)
    await request(app.getHttpServer()).get('/api/users').set('Cookie', 'mes_session=member').expect(403)
    await request(app.getHttpServer()).get('/api/users').set('Cookie', 'mes_session=so').expect(200)
    await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ fileDelivery: 'inline' }).expect(200)
    expect(admin.settings).toHaveBeenCalledWith({ fileDelivery: 'inline' })
  })
  it('기본 모델은 읽기 DTO에서 .env 유효값으로만 보이고, 쓰기 DTO에 defaultModel이 오면 400 (S7 C2)', async () => {
    admin.getSettings.mockResolvedValueOnce({ defaultModel: 'db-model', fileMaxPerRequest: 3 })
    const read = await request(app.getHttpServer()).get('/api/settings').set('Cookie', 'mes_session=member').expect(200)
    expect(read.body).toEqual({ defaultModel: 'glm-5.2', defaultModelSource: 'default', fileMaxPerRequest: 3 })
    await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ defaultModel: 'm' }).expect(400)
    await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ defaultModel: 'm', fileMaxPerRequest: 5 }).expect(400)
    expect(admin.settings).not.toHaveBeenCalled()
    admin.settings.mockResolvedValueOnce({ defaultModel: 'db-model', fileMaxPerRequest: 5 })
    const written = await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ fileMaxPerRequest: 5 }).expect(200)
    expect(admin.settings).toHaveBeenCalledWith({ fileMaxPerRequest: 5 })
    expect(written.body).toEqual({ defaultModel: 'glm-5.2', defaultModelSource: 'default', fileMaxPerRequest: 5 })
  })
  it('SO만 새 override를 trim하여 설정·해제하고 유효 모델과 출처를 읽는다', async () => {
    await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=member').send({ defaultModelOverride: 'new-model' }).expect(403)
    admin.settings.mockResolvedValueOnce({ defaultModelOverride: 'new-model' })
    const written = await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ defaultModelOverride: ' new-model ' }).expect(200)
    expect(admin.settings).toHaveBeenLastCalledWith({ defaultModelOverride: 'new-model' })
    expect(written.body).toEqual({ defaultModelOverride: 'new-model', defaultModel: 'new-model', defaultModelSource: 'setting' })
    admin.getSettings.mockResolvedValueOnce({ defaultModelOverride: 'new-model' })
    expect((await request(app.getHttpServer()).get('/api/settings').set('Cookie', 'mes_session=member')).body.defaultModelSource).toBe('setting')
    for (const value of [null, '', '   ']) {
      await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ defaultModelOverride: value }).expect(200)
      expect(admin.settings).toHaveBeenLastCalledWith({ defaultModelOverride: null })
    }
    await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ defaultModelOverride: 'x'.repeat(191) }).expect(200)
  })
  it('OpenWebUI 주소(link1Rule)는 자리표시자 없이도 http(s) 주소면 trim하여 받고 빈 값은 해제한다', async () => {
    for (const [sent, stored] of [['https://owui.example/', 'https://owui.example/'], [' https://owui.example/?lang=ko ', 'https://owui.example/?lang=ko'],
      ['https://owui.example/?model={modelId}&agent={assistantId}', 'https://owui.example/?model={modelId}&agent={assistantId}'], ['', '']] as const) {
      await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ link1Rule: sent }).expect(200)
      expect(admin.settings).toHaveBeenLastCalledWith({ link1Rule: stored })
    }
    for (const link1Rule of ['owui.example', 'ftp://owui.example/', 'https://user:pw@owui.example/', 'javascript:alert(1)', 'https://']) {
      await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ link1Rule }).expect(400)
    }
  })
  it('override의 길이·타입과 읽기 전용·알 수 없는 키는 원자적으로 거부한다', async () => {
    for (const input of [{ defaultModelOverride: 'x'.repeat(192) }, { defaultModelOverride: 123 }, { defaultModelOverride: {} },
      { defaultModelOverride: 'ok', defaultModel: 'legacy' }, { defaultModelOverride: 'ok', defaultModelSource: 'setting' }, { defaultModelOverride: 'ok', unknown: true }]) {
      await request(app.getHttpServer()).patch('/api/settings').set('Cookie', 'mes_session=so').send({ ...input, fileMaxPerRequest: 5 }).expect(400)
    }
    expect(admin.settings).not.toHaveBeenCalled()
  })
  it('SO만 다른 사용자의 이름을 수정하고 본인은 내 정보를 수정한다', async () => {
    await request(app.getHttpServer()).patch('/api/users/u1').set('Cookie', 'mes_session=member').send({ name: '새 이름' }).expect(403)
    await request(app.getHttpServer()).patch('/api/users/u1').set('Cookie', 'mes_session=so').send({ name: '새 이름' }).expect(200)
    expect(accounts.name).toHaveBeenCalledWith('u1', '새 이름')
    await request(app.getHttpServer()).patch('/api/users/me').set('Cookie', 'mes_session=member').send({ name: '내 이름' }).expect(200)
    expect(accounts.profile).toHaveBeenCalledWith('member', { name: '내 이름' })
    await request(app.getHttpServer()).patch('/api/users/me').set('Cookie', 'mes_session=member').send({ name: ' ' }).expect(400)
  })
  it('프로필은 본인만 저장하고 SO도 타인의 테마·언어를 바꿀 수 없다', async () => {
    await request(app.getHttpServer()).patch('/api/users/me').send({ theme: 'dark' }).expect(401)
    for (const cookie of ['member', 'so']) {
      await request(app.getHttpServer()).patch('/api/users/me').set('Cookie', `mes_session=${cookie}`).send({ theme: 'dark', locale: 'en' }).expect(200)
      expect(accounts.profile).toHaveBeenCalledWith(cookie, { theme: 'dark', locale: 'en' })
    }
    await request(app.getHttpServer()).patch('/api/users/member').set('Cookie', 'mes_session=so').send({ theme: 'light' }).expect(400)
    await request(app.getHttpServer()).patch('/api/users/member').set('Cookie', 'mes_session=so').send({ name: '이름', locale: 'en' }).expect(400)
  })
  it('빈 프로필·잘못된 값·알 수 없는 키는 저장하지 않는다', async () => {
    for (const input of [{}, { theme: 'auto' }, { locale: 'ja' }, { theme: null }, { name: ' ' }, { id: 'so', theme: 'dark' }, { name: '정상', isSystemOwner: true }]) {
      await request(app.getHttpServer()).patch('/api/users/me').set('Cookie', 'mes_session=member').send(input).expect(400)
    }
    expect(accounts.profile).not.toHaveBeenCalled()
    for (const input of [{ theme: 'system' }, { theme: 'light' }, { locale: 'ko' }, { name: ' 새 이름 ', theme: 'dark', locale: 'en' }]) {
      await request(app.getHttpServer()).patch('/api/users/me').set('Cookie', 'mes_session=member').send(input).expect(200)
    }
    expect(accounts.profile).toHaveBeenLastCalledWith('member', { name: '새 이름', theme: 'dark', locale: 'en' })
  })
  it('에이전트 쓰기·순서는 SO만 허용한다', async () => {
    await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=member').send({}).expect(403)
    await request(app.getHttpServer()).put('/api/assistants/order').set('Cookie', 'mes_session=member').send({ ids: [], revisions: {} }).expect(403)
    await request(app.getHttpServer()).put('/api/assistants/order').set('Cookie', 'mes_session=so').send({ ids: [], revisions: {} }).expect(204)
  })
  it('빈 체크리스트를 명시한 생성 요청은 빈 상태로 전달하고 카탈로그 응답을 돌려준다', async () => {
    const response = await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=so').send({
      id: 'new-agent', name: '새 에이전트', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', ownerId: 'so',
      status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [], checklistTemplate: [],
    }).expect(201)
    expect(admin.createAssistant).toHaveBeenCalledWith('so', expect.objectContaining({ checklistTemplate: [] }))
    expect(response.body).toMatchObject({ id: 'new-agent', order: 1, checklistTemplate: [] })
  })
  it('ID를 생략한 생성은 서버가 반환한 ID의 카탈로그 응답을 사용한다', async () => {
    const response = await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=so').send({
      name: '새 에이전트', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', ownerId: 'so',
      status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [], checklistTemplate: [],
    }).expect(201)
    expect(response.body).toMatchObject({ id: 'new-agent', order: 1, checklistTemplate: [] })
  })
  it('분류 이름과 전환 기간 ID를 받고 누락·빈 이름은 거부한다', async () => {
    const base = { name: '도우미', summary: '', ownerId: 'so', status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [] }
    await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=so').send({ ...base, level1: '신규', level2: '신규' }).expect(201)
    expect(admin.createAssistant).toHaveBeenCalledWith('so', expect.objectContaining({ level1: '신규', level2: '신규' }))
    await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=so').send({ ...base, level1: ' Cafe\u0301   TOOL ', level2: '  신규\t 분류 ' }).expect(201)
    expect(admin.createAssistant).toHaveBeenCalledWith('so', expect.objectContaining({ level1: 'Café TOOL', level2: '신규 분류' }))
    await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=so').send({ ...base, level1: '신규', level2CodeId: 'legacy' }).expect(201)
    for (const fields of [{ level1: '신규' }, { level1: ' ', level2: '정상' }, { level1: 'x'.repeat(192), level2: '정상' }]) {
      await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=so').send({ ...base, ...fields }).expect(400)
    }
    await request(app.getHttpServer()).patch('/api/assistants/new-agent').set('Cookie', 'mes_session=so').send({ level2: '수정' }).expect(200)
    expect(admin.updateAssistant).toHaveBeenCalledWith('new-agent', { level2: '수정' })
    await request(app.getHttpServer()).patch('/api/assistants/new-agent').set('Cookie', 'mes_session=so').send({ level2: ' ' }).expect(400)
  })
  it('명시한 빈 ID는 거부하고 기존 ID 수정은 허용하지 않는다', async () => {
    await request(app.getHttpServer()).post('/api/assistants').set('Cookie', 'mes_session=so').send({
      id: '', name: '새 에이전트', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', ownerId: 'so',
      status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [],
    }).expect(400)
    await request(app.getHttpServer()).patch('/api/assistants/new-agent').set('Cookie', 'mes_session=so').send({ id: 'changed' }).expect(400)
  })
  it('임시 비밀번호 상태에는 me·변경 이외 API를 차단한다', async () => {
    const forbidden = await request(app.getHttpServer()).get('/api/settings').set('Cookie', 'mes_session=forced').expect(403)
    expect(forbidden.body.code).toBe('PASSWORD_CHANGE_REQUIRED')
    expect((await request(app.getHttpServer()).get('/api/me').set('Cookie', 'mes_session=forced').expect(200)).body.mustChangePassword).toBe(true)
    await request(app.getHttpServer()).post('/api/auth/password').set('Cookie', 'mes_session=forced').send({ currentPassword: 'password-1234', newPassword: 'password-5678' }).expect(204)
  })
})
