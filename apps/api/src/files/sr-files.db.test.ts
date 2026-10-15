import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/mysql2'
import { and, eq } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'
import type { ChatProvider, ChatRequest } from '@mes/llm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config/config.js'
import { createPool } from '../db/connection.js'
import type { Db } from '../db/db.module.js'
import { runMigrations } from '../db/migrate.js'
import { activityLog, appSetting, appUser, assistant, fileObject, task, taskInput } from '../db/schema.js'
import { seedCatalog } from '../db/seed.js'
import { EventsService } from '../events/events.service.js'
import { RequestsService } from '../requests/requests.service.js'
import { SrService } from '../sr/sr.service.js'
import { TaskExtrasService } from '../tasks/task-extras.service.js'
import { DbTasksService } from '../tasks/tasks.service.js'
import { createTempDb, MIGRATION_TEST_TIMEOUT_MS } from '../test/tempDb.js'
import { DbFilesService } from './files.service.js'
import { FileStorageService } from './fileStorage.service.js'

/** S13: SR에서 시작한 업무의 자료함에 연결 SR의 접수 파일 전체를 보이고 AI 입력으로 기본 선택한다. */
describe('연결 SR 첨부 → 업무 자료함', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  let db: Db
  let root: string
  let config: ReturnType<typeof loadConfig>
  let sr: SrService
  let tasks: DbTasksService
  let files: DbFilesService
  let assistantId: string
  const captured: ChatRequest[] = []
  const provider: ChatProvider = { kind: 'mock', ping: async () => ({ ok: true, detail: '' }), listModels: async () => [],
    async *stream(request) { captured.push(request); yield { type: 'delta', text: '응답' }; yield { type: 'done' } } }

  beforeAll(async () => {
    temp = await createTempDb('sr_files')
    await runMigrations(temp.url)
    client = createPool(temp.url)
    db = drizzle(client)
    await seedCatalog(db)
    await db.insert(appUser).values([
      { id: 'requester', name: 'Requester', initials: 'R', color: '#123456', isBusinessOwner: true },
      { id: 'other', name: 'Other', initials: 'O', color: '#123456', isBusinessOwner: true },
      { id: 'bo-member', name: 'BO Member', initials: 'B', color: '#123456', isBusinessOwner: true },
      { id: 'staff', name: 'Staff', initials: 'S', color: '#123456' },
    ])
    assistantId = (await db.select().from(assistant))[0]!.id
    await db.update(assistant).set({ ownerId: 'staff' }).where(eq(assistant.id, assistantId))
    await db.update(appSetting).set({ value: assistantId }).where(eq(appSetting.key, 'srIntakeAssistantId'))
    root = await mkdtemp(join(tmpdir(), 'mes-sr-files-'))
    config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', LLM_DEFAULT_MODEL: 'default-model', FILE_STORAGE_ROOT: root })
    const events = new EventsService()
    tasks = new DbTasksService(db, events)
    sr = new SrService(db, tasks, events)
    files = new DbFilesService(db, new FileStorageService(root), config, events)
  }, MIGRATION_TEST_TIMEOUT_MS)
  afterAll(async () => { await client?.end(); await temp?.drop(); if (root) await rm(root, { recursive: true, force: true }) })
  beforeEach(() => { captured.length = 0 })

  /** 본문에 첨부한 A와 접수 대화에 올린 B를 가진 SR — 둘 다 자료함에 보인다 */
  async function submittedSr(title: string) {
    const draft = await sr.create('requester')
    const official = await files.uploadSr('requester', draft.id, `${title}-spec.txt`, 'text/plain', Buffer.from(`SR-ATTACHMENT-BODY ${title}`))
    const candidate = await files.uploadSr('requester', draft.id, `${title}-chat.txt`, 'text/plain', Buffer.from(`CANDIDATE-ONLY ${title}`))
    const submitted = await sr.submit('requester', draft.id, { title, body: '본문', attachmentIds: [official.id] })
    return { srId: draft.id, code: submitted.code, official, candidate }
  }
  async function startFrom(srId: string, forceNew = false) {
    const started = await sr.startTask('staff', srId, { assistantId, forceNew })
    if ('candidates' in started) throw new Error('새 연결 업무가 만들어져야 합니다')
    return started
  }

  it('startTask는 접수 파일 전부를 참고 입력으로 기본 선택하고, 파일은 복사하지 않고 같은 file_object를 참조한다', async () => {
    const { srId, code, official, candidate } = await submittedSr('기본선택')
    const started = await startFrom(srId)
    expect(started.inputs.map(item => item.fileId).sort()).toEqual([official.id, candidate.id].sort())
    expect(started.inputs.every(item => item.weight === 'reference' && item.selectedBy === 'staff')).toBe(true)
    expect(await db.select().from(fileObject).where(eq(fileObject.originTaskId, started.id))).toEqual([])
    expect((await db.select().from(fileObject).where(eq(fileObject.originSrId, srId))).map((row) => row.id).sort()).toEqual([official.id, candidate.id].sort())
    const shown = await files.candidates(started.id, 'staff')
    expect(shown.srFiles?.map(item => item.file.id).sort()).toEqual([official.id, candidate.id].sort())
    expect(shown.srFiles?.[0]).toMatchObject({ srId, srCode: code, srTitle: '기본선택', selected: 'reference' })
    // 태그 공유 후보(task_file)와 섞지 않는다
    expect(shown.files.map((item) => item.file.id)).not.toContain(official.id)
    const logged = await db.select().from(activityLog).where(and(eq(activityLog.taskId, started.id), eq(activityLog.type, 'input.selected')))
    expect(logged.map(row => (row.payload as { name: string }).name).sort()).toEqual([official.name, candidate.name].sort())
    // 같은 SR에서 새 업무를 하나 더 시작해도 같은 파일을 참조한다
    const again = await startFrom(srId, true)
    expect(again.inputs.map((item) => item.fileId).sort()).toEqual([official.id, candidate.id].sort())
  })

  it('이미 시작된 업무는 구역에 보이기만 하고 체크는 사람이 한다', async () => {
    const { srId, official, candidate } = await submittedSr('기존업무')
    const existing = await tasks.create('staff', { assistantId })
    await db.update(task).set({ srId }).where(eq(task.id, existing.task.id))
    expect((await tasks.get(existing.task.id)).inputs).toEqual([])
    expect((await files.candidates(existing.task.id, 'staff')).srFiles?.map(item => item.file.id).sort()).toEqual([official.id, candidate.id].sort())
    expect((await files.candidates(existing.task.id, 'staff')).srFiles?.[0]).not.toHaveProperty('selected')
    await files.setInput('staff', existing.task.id, official.id, 'main')
    expect((await tasks.get(existing.task.id)).inputs).toEqual([expect.objectContaining({ fileId: official.id, weight: 'main' })])
    // 연결 SR 첨부가 없는 업무는 빈 구역
    expect((await files.candidates((await tasks.create('staff', { assistantId })).task.id, 'staff')).srFiles).toEqual([])
  })

  it('연결 SR 접수 파일은 다시 담을 수 있고 다른 SR 첨부는 400, ×(제거)는 언제나 된다', async () => {
    const { srId, official, candidate } = await submittedSr('선택범위')
    const foreign = await submittedSr('다른SR')
    const started = await startFrom(srId)
    await files.setInput('staff', started.id, candidate.id, 'reference')
    await expect(files.setInput('staff', started.id, foreign.official.id, 'reference')).rejects.toMatchObject({ status: 400 })
    await files.setInput('staff', started.id, official.id, null)
    await files.setInput('staff', started.id, candidate.id, null)
    expect((await tasks.get(started.id)).inputs).toEqual([])
    expect((await files.candidates(started.id, 'staff')).srFiles?.[0]).not.toHaveProperty('selected')
    await files.setInput('staff', started.id, official.id, 'reference')
    expect((await tasks.get(started.id)).inputs.map((item) => item.fileId)).toEqual([official.id])
  })

  it('보낸 것=본 것: 트레이 추정과 실제 전송이 같은 조립을 타고, ×로 빼면 둘 다에서 빠진다', async () => {
    const { srId, official } = await submittedSr('전송')
    const started = await startFrom(srId)
    const requests = new RequestsService(db, config, provider)
    try {
      const estimate = await requests.estimate('staff', started.threadId!, { draft: '분석해 줘' })
      expect(estimate.inputs).toHaveLength(2)
      expect(estimate.inputs[0]).toMatchObject({ kind: 'file', fileId: official.id, name: official.name, source: 'SR 첨부', weight: 'reference' })
      await (await requests.start('staff', started.threadId!, { content: '분석해 줘' }, 'sr-files-send-1')).done
      expect(captured).toHaveLength(1)
      expect(JSON.stringify(captured[0]!.messages)).toContain('SR-ATTACHMENT-BODY 전송')
      // SR 시작 시 담긴 첨부는 첫 요청에 한 번 가고 스테이징에서 빠진다
      expect((await tasks.get(started.id)).inputs).toEqual([])
      expect((await requests.estimate('staff', started.threadId!, { draft: '다시' })).inputs).toEqual([])
      await (await requests.start('staff', started.threadId!, { content: '다시' }, 'sr-files-send-2')).done
      expect(captured).toHaveLength(2)
      expect(JSON.stringify(captured[1]!.messages)).not.toContain('SR-ATTACHMENT-BODY')
    } finally { requests.onModuleDestroy() }
  })

  it('SR intake sends attachments only for their turn and supports reusing them', async () => {
    const draft = await sr.create('requester')
    const file = await files.uploadSr('requester', draft.id, 'intake.txt', 'text/plain', Buffer.from('INTAKE-ONE-TURN'))
    const requests = new RequestsService(db, config, provider)
    try {
      const estimate = await requests.estimate('requester', draft.threadId, { draft: 'first', attachmentIds: [file.id] })
      const first = await requests.start('requester', draft.threadId, { content: 'first', attachmentIds: [file.id] }, 'intake-once')
      await first.done
      expect((await requests.get(first.id)).bytes).toBe(estimate.bytes)
      expect(JSON.stringify(captured[0]!.messages)).toContain('INTAKE-ONE-TURN')
      await (await requests.start('requester', draft.threadId, { content: 'second' }, 'intake-next')).done
      expect(JSON.stringify(captured[1]!.messages)).not.toContain('INTAKE-ONE-TURN')
      await (await requests.start('requester', draft.threadId, { content: 'reuse', attachmentIds: [file.id] }, 'intake-reuse')).done
      expect(JSON.stringify(captured[2]!.messages)).toContain('INTAKE-ONE-TURN')
    } finally { requests.onModuleDestroy() }
  })

  it('SR retries reconstruct recorded attachments, omit later uploads, and retain exclusions across retries', async () => {
    const draft = await sr.create('requester')
    const file = await files.uploadSr('requester', draft.id, 'retry.txt', 'text/plain', Buffer.from('ORIGINAL-INTAKE-FILE'))
    const requests = new RequestsService(db, config, { ...provider, async *stream() { yield { type: 'error', message: 'failed' } } })
    try {
      const first = await requests.start('requester', draft.threadId, { content: 'first', attachmentIds: [file.id] }, 'intake-retry-first')
      await first.done
      await files.uploadSr('requester', draft.id, 'later.txt', 'text/plain', Buffer.from('LATER-INTAKE-FILE'))
      const retry = await requests.retry('requester', first.id, {}, 'intake-retry-again')
      await retry.done
      expect((await requests.get(retry.id)).inputs).toMatchObject([{ fileId: file.id }])
      expect(JSON.stringify(await requests.snapshot(retry.id))).not.toContain('LATER-INTAKE-FILE')
      const excluded = await requests.retry('requester', retry.id, { excludeFileIds: [file.id] }, 'intake-retry-excluded')
      await excluded.done
      expect((await requests.get(excluded.id)).inputs).toEqual([])
      const stillExcluded = await requests.retry('requester', excluded.id, {}, 'intake-retry-still-excluded')
      await stillExcluded.done
      expect((await requests.get(stillExcluded.id)).inputs).toEqual([])
    } finally { requests.onModuleDestroy() }
  })

  it('excludes deleted intake uploads from the linked task library and initial selection', async () => {
    const { srId, official, candidate } = await submittedSr('삭제제외')
    await db.update(fileObject).set({ deletedAt: new Date() }).where(eq(fileObject.id, candidate.id))
    const started = await startFrom(srId)
    expect(started.inputs.map(item => item.fileId)).toEqual([official.id])
    expect((await files.candidates(started.id, 'staff')).srFiles?.map(item => item.file.id)).toEqual([official.id])
  })

  it('한도를 넘으면 자르지 않고 전송을 막는다', async () => {
    const { srId } = await submittedSr('한도')
    const started = await startFrom(srId)
    const requests = new RequestsService(db, config, provider)
    await db.insert(appSetting).values({ key: 'requestBudgetBytes', value: 64 }).onDuplicateKeyUpdate({ set: { value: 64 } })
    try {
      const estimate = await requests.estimate('staff', started.threadId!, { draft: '분석' })
      expect(estimate.overLimit).toBe(true)
      expect(estimate.inputs).toHaveLength(2)
      const over = await requests.start('staff', started.threadId!, { content: '분석' }, 'sr-files-over')
      await over.done
      expect(captured).toHaveLength(0)
      // 시작과 함께 스테이징은 비지만, 무엇을 담았는지는 요청 기록에 남아 재시도(빼고 다시)가 그 기준으로 된다
      expect(await requests.get(over.id)).toMatchObject({ status: 'failed', code: 'REQUEST_TOO_LARGE', inputs: [{ fileId: expect.any(String) }, { fileId: expect.any(String) }] })
      expect((await tasks.get(started.id)).inputs).toEqual([])
    } finally {
      await db.delete(appSetting).where(eq(appSetting.key, 'requestBudgetBytes'))
      requests.onModuleDestroy()
    }
  })

  it('업무 참여자는 연결 SR 첨부 정본을 읽고, 그 외는 지금 규칙(403)을 유지한다', async () => {
    const { srId, official, candidate } = await submittedSr('권한')
    const started = await startFrom(srId)
    await expect(files.get(official.id, 'bo-member')).rejects.toMatchObject({ status: 403 })
    await tasks.update('staff', started.id, { assigneeIds: ['staff', 'bo-member'] })
    expect(await files.get(official.id, 'bo-member')).toMatchObject({ id: official.id })
    expect(new TextDecoder().decode(await files.content(official.id, 'bo-member'))).toBe('SR-ATTACHMENT-BODY 권한')
    // 본문에서 고르지 않은 접수 파일도 참여자에게 허용하고, 무관한 BO는 403
    expect(await files.get(candidate.id, 'bo-member')).toMatchObject({ id: candidate.id })
    await expect(files.get(official.id, 'other')).rejects.toMatchObject({ status: 403 })
    // 요청자 본인은 기존대로
    expect(await files.get(official.id, 'requester')).toMatchObject({ id: official.id })
    // 참여에서 빠지면 다시 403
    await tasks.update('staff', started.id, { assigneeIds: ['staff'] })
    await expect(files.content(official.id, 'bo-member')).rejects.toMatchObject({ status: 403 })
    // 업무가 삭제되면 연결 참여 근거도 사라진다
    await tasks.update('staff', started.id, { assigneeIds: ['staff', 'bo-member'] })
    await tasks.delete(started.id, 'staff')
    await expect(files.get(official.id, 'bo-member')).rejects.toMatchObject({ status: 403 })
  })

  it('완료 리포트의 입력 자료에 SR 첨부가 빠지지 않는다', async () => {
    const { srId, official } = await submittedSr('리포트')
    const started = await startFrom(srId)
    const extras = new TaskExtrasService(db, { kind: 'mock' } as never, { runAuxiliary: async () => undefined } as never, new FileStorageService(root), { publish: () => undefined } as never)
    const { content } = await extras.preview('staff', started.id)
    expect(content).toContain(`[참고] ${official.name} v1 ← SR 첨부`)
    // 보내서 스테이징에서 빠진 뒤에도 '쓴 자료'로 리포트에 남는다
    const requests = new RequestsService(db, config, provider)
    try { await (await requests.start('staff', started.threadId!, { content: '분석' }, 'sr-files-report')).done }
    finally { requests.onModuleDestroy() }
    expect((await tasks.get(started.id)).inputs).toEqual([])
    expect((await extras.preview('staff', started.id)).content).toContain(`[참고] ${official.name} v1 ← SR 첨부`)
  })

  it('입력 선택 행은 SR 첨부 자체를 가리킨다(task_input.file_id = SR file_object.id)', async () => {
    const { srId, official, candidate } = await submittedSr('행')
    const started = await startFrom(srId)
    expect((await db.select({ fileId: taskInput.fileId }).from(taskInput).where(eq(taskInput.taskId, started.id))).map(row => row.fileId).sort()).toEqual([official.id, candidate.id].sort())
  })
})
