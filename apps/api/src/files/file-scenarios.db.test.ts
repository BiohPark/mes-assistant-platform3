import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/mysql2'
import { eq } from 'drizzle-orm'
import type { Pool } from 'mysql2/promise'
import type { ChatProvider } from '@mes/llm'
import type { RequestInfo } from '@mes/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPool } from '../db/connection.js'
import type { Db } from '../db/db.module.js'
import { appUser, assistant, messageAttachment, taskInput } from '../db/schema.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { createTempDb } from '../test/tempDb.js'
import { loadConfig } from '../config/config.js'
import { DbTasksService } from '../tasks/tasks.service.js'
import { TaskExtrasService } from '../tasks/task-extras.service.js'
import { RequestsService } from '../requests/requests.service.js'
import { EventsService } from '../events/events.service.js'
import { SrService } from '../sr/sr.service.js'
import { FileStorageService, sha256 } from './fileStorage.service.js'
import { DbFilesService } from './files.service.js'

/**
 * S8 파일 시나리오 — tasks/s8-file-scenarios/artifacts/file-scenarios.md 의 T-*·U-*·A-* 항목.
 * 데모(mes-assistant-platform2) 동작과 docs/fusion-design.md §5 를 기준으로 한다.
 */
describe('file scenarios (S8)', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  let db: Db
  let root: string
  let files: DbFilesService
  let tasks: DbTasksService
  let requests: RequestsService
  let sr: SrService
  let assistantId: string
  let assistantName: string
  const provider: ChatProvider = {
    kind: 'mock', ping: async () => ({ ok: true, detail: '' }), listModels: async () => ['glm-5.2'],
    async *stream() { yield { type: 'delta', text: '응답' }; yield { type: 'done' } },
  }
  const text = (value: string) => Buffer.from(value)
  const uid = () => randomUUID().slice(0, 8)
  const comparable = (info: RequestInfo) => ({ bytes: info.bytes, limitBytes: info.limitBytes, srCodes: info.srCodes, inputs: info.inputs })
  async function completed(threadId: string, content: string, body: { attachmentIds?: string[]; oneShotFileIds?: string[] } = {}) {
    const started = await requests.start('member', threadId, { content, ...body }, `key-${randomUUID()}`)
    const events: Array<Record<string, unknown>> = []
    const unsubscribe = requests.subscribe(started.id, (event) => { if (event.event === 'completed') events.push(event.data) })
    await started.done
    unsubscribe()
    const record = await requests.get(started.id)
    expect(record.status).toBe('succeeded')
    return { id: started.id, record, info: events[0]?.requestInfo as RequestInfo }
  }

  beforeAll(async () => {
    temp = await createTempDb('scenarios')
    await runMigrations(temp.url)
    client = createPool(temp.url)
    db = drizzle(client)
    await seedCatalog(db)
    await db.insert(appUser).values([
      { id: 'member', name: 'Member', initials: 'M', color: '#123456' },
      { id: 'other', name: 'Other', initials: 'O', color: '#123456' },
      { id: 'bo', name: 'Business Owner', initials: 'B', color: '#123456', isBusinessOwner: true },
    ])
    const first = (await db.select().from(assistant))[0]!
    assistantId = first.id
    assistantName = first.name
    root = await mkdtemp(join(tmpdir(), 'mes-scenarios-'))
    const config = loadConfig({ DATABASE_URL: temp.url, SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', FILE_STORAGE_ROOT: root, FILE_MAX_BYTES: '1024', FILE_MAX_PER_REQUEST: '2' })
    const storage = new FileStorageService(root)
    files = new DbFilesService(db, storage, config)
    requests = new RequestsService(db, config, provider)
    const extras = new TaskExtrasService(db, provider, requests, storage, new EventsService())
    tasks = new DbTasksService(db, undefined, extras)
    sr = new SrService(db, tasks, new EventsService())
  })
  afterAll(async () => { requests?.onModuleDestroy(); await client?.end(); await temp?.drop(); if (root) await rm(root, { recursive: true, force: true }) })

  describe('태그 연동 공유', () => {
    it('T-01/T-02 단일·다중 태그를 직접 공유하는 대화의 파일이 출처(코드·제목·에이전트)와 공통 태그와 함께 보인다', async () => {
      const [x, y] = [`x-${uid()}`, `y-${uid()}`]
      const a = (await tasks.create('member', { assistantId, tags: [x, y], title: '원본 대화' })).task
      const single = (await tasks.create('member', { assistantId, tags: [x] })).task
      const both = (await tasks.create('member', { assistantId, tags: [x, y] })).task
      const file = await files.upload('member', a.id, 'spec.txt', 'text/plain', text('spec'))
      const fromSingle = (await files.candidates(single.id)).files.find((item) => item.file.id === file.id)
      expect(fromSingle).toMatchObject({ sourceTaskId: a.id, sourceCode: a.code, sourceTitle: '원본 대화', sourceAssistantId: assistantId, viaTags: [x], role: 'upload' })
      const fromBoth = (await files.candidates(both.id)).files.find((item) => item.file.id === file.id)
      expect(fromBoth?.viaTags.sort()).toEqual([x, y].sort())
      // 자기 파일은 공유 자료함이 아니라 '이 대화' 출처로 보인다
      expect((await files.candidates(a.id)).files.find((item) => item.file.id === file.id)).toMatchObject({ sourceTaskId: a.id, sourceCode: a.code, viaTags: [] })
    })

    it('T-03 공유 뒤 태그를 추가하면 그때부터 후보가 되고, 태그를 빼면 선택만 남는다(T-04)', async () => {
      const tag = `late-${uid()}`
      const source = (await tasks.create('member', { assistantId, tags: [tag] })).task
      const consumer = (await tasks.create('member', { assistantId })).task
      const file = await files.upload('member', source.id, 'late.txt', 'text/plain', text('late'))
      expect((await files.candidates(consumer.id)).files).toEqual([])
      await expect(files.setInput('member', consumer.id, file.id, 'reference')).rejects.toMatchObject({ status: 400 })
      await tasks.addTag('member', consumer.id, tag)
      expect((await files.candidates(consumer.id)).files.map((item) => item.file.id)).toEqual([file.id])
      await files.setInput('member', consumer.id, file.id, 'reference')
      await tasks.removeTag('member', consumer.id, tag)
      const detached = (await files.candidates(consumer.id)).files.find((item) => item.file.id === file.id)
      expect(detached).toMatchObject({ selected: 'reference', viaTags: [] })
      await files.setInput('member', consumer.id, file.id, 'main') // 등급 변경은 가능
      expect((await tasks.get(consumer.id)).inputs).toMatchObject([{ fileId: file.id, weight: 'main' }])
      await files.setInput('member', consumer.id, file.id, null)
      expect((await files.candidates(consumer.id)).files).toEqual([])
      await expect(files.setInput('member', consumer.id, file.id, 'reference')).rejects.toMatchObject({ status: 400 })
    })

    it('T-05 대소문자·공백·# 표기가 달라도 같은 태그로 공유되고 표기는 처음 쓴 것으로 보인다', async () => {
      const base = `Project ${uid()}`
      const first = (await tasks.create('member', { assistantId, tags: [`#${base}`] })).task
      const upper = (await tasks.create('member', { assistantId, tags: [`  ${base.toUpperCase().replace(' ', '-')}  `] })).task
      const lower = (await tasks.create('member', { assistantId })).task
      await tasks.addTag('member', lower.id, base.toLowerCase().replace(' ', '-'))
      const file = await files.upload('member', first.id, 'notation.txt', 'text/plain', text('n'))
      const label = base.replace(' ', '-')
      expect((await tasks.get(first.id)).tags).toEqual([label])
      expect((await tasks.get(upper.id)).tags).toEqual([label])
      expect((await tasks.get(lower.id)).tags).toEqual([label])
      for (const consumer of [upper, lower]) {
        expect((await files.candidates(consumer.id)).files.find((item) => item.file.id === file.id)).toMatchObject({ viaTags: [label] })
      }
      await tasks.removeTag('member', upper.id, `#${base.toLowerCase()}`)
      expect((await files.candidates(upper.id)).files).toEqual([])
    })

    it('T-06 SR 코드 태그는 대문자로 정규화되어 공유되고, 요청에는 연결된 SR 본문이 들어간다', async () => {
      const draft = await sr.create('member')
      const submitted = await sr.submit('member', draft.id, { title: '알람 개선', body: 'SR 본문입니다', attachmentIds: [] })
      const code = submitted.code!
      const a = (await tasks.create('member', { assistantId, tags: [code.toLowerCase()] })).task
      const b = (await tasks.create('member', { assistantId, tags: [code] })).task
      expect((await tasks.get(a.id)).tags).toEqual([code])
      const file = await files.upload('member', a.id, 'sr-shared.txt', 'text/plain', text('sr'))
      expect((await files.candidates(b.id)).files.find((item) => item.file.id === file.id)).toMatchObject({ viaTags: [code] })
      const estimate = await requests.estimate('member', (await tasks.get(a.id)).threadId!, { draft: 'SR 확인' })
      expect(estimate.srCodes).toEqual([code])
      const { id } = await completed((await tasks.get(a.id)).threadId!, 'SR 확인')
      const snapshot = await requests.snapshot(id) as { messages: Array<{ role: string; content: string }> }
      expect(snapshot.messages[0]!.content).toContain('## 연결된 SR (1)')
      expect(snapshot.messages[0]!.content).toContain(`### ${code} 알람 개선\nSR 본문입니다`)
      expect(snapshot.messages[0]!.content).toContain(`- 태그: ${code}`)
    })

    it('T-08 완료된 출처 대화의 파일은 계속 공유되고, 완료된 대화 자신은 선택·업로드를 거부한다', async () => {
      const tag = `done-${uid()}`
      const source = (await tasks.create('member', { assistantId, tags: [tag] })).task
      const consumer = (await tasks.create('member', { assistantId, tags: [tag] })).task
      const file = await files.upload('member', source.id, 'done.txt', 'text/plain', text('done'))
      await tasks.setStatus('member', source.id, 'done', '완료')
      expect((await files.candidates(consumer.id)).files.map((item) => item.file.id)).toContain(file.id) // 완료 리포트 산출물도 함께 보일 수 있다
      await files.setInput('member', consumer.id, file.id, 'main')
      expect(Buffer.from(await files.content(file.id, 'member')).toString()).toBe('done')
      await tasks.setStatus('member', consumer.id, 'done', '완료')
      await expect(files.setInput('member', consumer.id, file.id, 'reference')).rejects.toMatchObject({ status: 409 })
      await expect(files.upload('member', consumer.id, 'x.txt', 'text/plain', text('x'))).rejects.toMatchObject({ status: 409 })
      await expect(files.saveOutput('member', consumer.id, 'x.md', '# x')).rejects.toMatchObject({ status: 409 })
      await expect(files.upload('member', source.id, 'done.txt', 'text/plain', text('v2'))).rejects.toMatchObject({ status: 409 })
    })

    it('T-09 선택한 버전은 고정되고(요청 기록도 그 버전), 새 버전은 안내만 하며 사람이 바꿔야 반영된다', async () => {
      const tag = `ver-${uid()}`
      const source = (await tasks.create('member', { assistantId, tags: [tag] })).task
      const consumer = (await tasks.create('member', { assistantId, tags: [tag] })).task
      const v1 = await files.upload('member', source.id, 'report.txt', 'text/plain', text('v1 body'))
      await files.setInput('member', consumer.id, v1.id, 'main')
      const v2 = await files.upload('member', source.id, 'report.txt', 'text/plain', text('v2 body'))
      const candidates = (await files.candidates(consumer.id)).files
      expect(candidates.find((item) => item.file.id === v1.id)).toMatchObject({ selected: 'main', newerVersionId: v2.id })
      expect(candidates.find((item) => item.file.id === v2.id)).toMatchObject({ olderVersionIds: [v1.id] })
      const threadId = (await tasks.get(consumer.id)).threadId!
      const { id, record } = await completed(threadId, '버전 확인')
      expect(record.inputs).toMatchObject([{ kind: 'file', fileId: v1.id, fileVersion: 1, weight: 'main', delivery: 'inline' }])
      const snapshot = await requests.snapshot(id) as { messages: Array<{ content: string }> }
      expect(snapshot.messages[0]!.content).toContain('v1 body')
      expect(snapshot.messages[0]!.content).not.toContain('v2 body')
      await files.switchInputVersion('member', consumer.id, v1.id, v2.id)
      expect((await tasks.get(consumer.id)).inputs).toMatchObject([{ fileId: v2.id, weight: 'main' }])
      expect((await requests.estimate('member', threadId, { draft: '다시' })).inputs).toMatchObject([{ fileId: v2.id, version: 2 }])
    })

    it('T-10 다른 대화가 선택한 파일은 지울 수 없고, 지운 파일은 후보·내려받기에서 사라진다', async () => {
      const tag = `del-${uid()}`
      const source = (await tasks.create('member', { assistantId, tags: [tag] })).task
      const consumer = (await tasks.create('member', { assistantId, tags: [tag] })).task
      const file = await files.upload('member', source.id, 'gone.txt', 'text/plain', text('gone'))
      await files.setInput('member', consumer.id, file.id, 'reference')
      await expect(files.remove(file.id, 'member')).rejects.toMatchObject({ status: 409 })
      await files.setInput('member', consumer.id, file.id, null)
      await files.remove(file.id, 'member')
      expect((await files.candidates(consumer.id)).files).toEqual([])
      expect(await files.filesForTask(source.id)).toEqual([])
      await expect(files.get(file.id, 'member')).rejects.toMatchObject({ status: 404 })
      await expect(files.content(file.id, 'member')).rejects.toMatchObject({ status: 404 })
      await expect(files.setInput('member', consumer.id, file.id, 'reference')).rejects.toMatchObject({ status: 404 })
    })

    it('T-11 다른 담당자는 공유 파일을 보고 내려받지만, 요청자(BO)는 대화 파일을 보지도 받지도 못한다', async () => {
      const tag = `perm-${uid()}`
      const source = (await tasks.create('member', { assistantId, tags: [tag] })).task
      const consumer = (await tasks.create('member', { assistantId, tags: [tag], assigneeIds: ['member', 'bo'] })).task
      const file = await files.upload('member', source.id, 'perm.txt', 'text/plain', text('perm'))
      expect((await files.candidates(consumer.id, 'other')).files.map((item) => item.file.id)).toEqual([file.id])
      expect(Buffer.from(await files.content(file.id, 'other')).toString()).toBe('perm')
      await files.setInput('other', consumer.id, file.id, 'reference')
      expect((await files.candidates(consumer.id, 'bo')).files).toEqual([])
      await expect(files.content(file.id, 'bo')).rejects.toMatchObject({ status: 403 })
      await expect(files.get(file.id, 'bo')).rejects.toMatchObject({ status: 403 })
      await expect(files.setInput('bo', consumer.id, file.id, 'main')).rejects.toMatchObject({ status: 403 })
      await expect(files.candidates(source.id, 'bo')).rejects.toMatchObject({ status: 403 })
    })

    it('T-12 ★ 주 입력이 ☑ 참고보다 먼저 가고, 트레이 추정과 실제 전송이 같은 입력·바이트를 낸다', async () => {
      const tag = `tray-${uid()}`
      const source = (await tasks.create('member', { assistantId, tags: [tag] })).task
      const consumer = (await tasks.create('member', { assistantId, tags: [tag] })).task
      const shared = await files.upload('member', source.id, 'shared.txt', 'text/plain', text('shared body'))
      const own = await files.upload('member', consumer.id, 'own.txt', 'text/plain', text('own body'))
      const once = await files.upload('member', consumer.id, 'once.txt', 'text/plain', text('once body'))
      await files.setInput('member', consumer.id, own.id, 'reference')
      await files.setInput('member', consumer.id, shared.id, 'main')
      const threadId = (await tasks.get(consumer.id)).threadId!
      const body = { draft: '자료로 답변', attachmentIds: [once.id], oneShotFileIds: [once.id] }
      const estimate = await requests.estimate('member', threadId, body)
      const { record, id, info } = await completed(threadId, body.draft, { attachmentIds: body.attachmentIds, oneShotFileIds: body.oneShotFileIds })
      expect(comparable(estimate)).toEqual(comparable(info))
      expect(record.inputs).toMatchObject([
        { fileId: shared.id, weight: 'main', oneShot: false, sourceLabel: `shared.txt · ${source.code} · ${assistantName}` },
        { fileId: own.id, weight: 'reference', oneShot: false, sourceLabel: 'own.txt · 이 대화' },
        { fileId: once.id, weight: 'reference', oneShot: true },
      ])
      const snapshot = await requests.snapshot(id) as { messages: Array<{ content: string }> }
      const prompt = snapshot.messages[0]!.content
      expect(prompt.indexOf('shared body')).toBeLessThan(prompt.indexOf('own body'))
      expect(prompt.indexOf('own body')).toBeLessThan(prompt.indexOf('once body'))
      expect((await tasks.get(consumer.id)).inputs.map((item) => item.fileId)).toEqual([shared.id, own.id]) // 이번 메시지만 첨부는 고정되지 않는다
    })
  })

  describe('업·다운로드', () => {
    it('U-01 일반 첨부는 메타(크기·sha256·mime 기본값)와 바이트를 그대로 보관한다', async () => {
      const owner = (await tasks.create('member', { assistantId })).task
      const bytes = text('plain upload')
      const file = await files.upload('member', owner.id, 'data.bin', '', bytes)
      expect(file).toMatchObject({ originTaskId: owner.id, name: 'data.bin', mime: 'application/octet-stream', size: bytes.byteLength, sha256: sha256(bytes), source: 'upload', isOutput: false, version: 1, uploadedBy: 'member' })
      expect((await files.filesForTask(owner.id)).map((item) => item.id)).toEqual([file.id])
      expect(Buffer.from(await files.content(file.id, 'member'))).toEqual(bytes)
      expect(await files.get(file.id, 'member')).toEqual(file)
    })

    it('U-02 대화 첨부는 메시지에 묶이고 고정 첨부만 참고 입력으로 남는다', async () => {
      const { task: owner, thread } = await tasks.create('member', { assistantId })
      const pinned = await files.upload('member', owner.id, 'pinned.txt', 'text/plain', text('pinned'))
      const once = await files.upload('member', owner.id, 'once.txt', 'text/plain', text('once'))
      const { record } = await completed(thread.id, '첨부와 함께', { attachmentIds: [pinned.id, once.id], oneShotFileIds: [once.id] })
      expect((await db.select().from(messageAttachment).where(eq(messageAttachment.messageId, (await tasks.messages(thread.id))[0]!.id))).map((row) => row.fileId).sort()).toEqual([pinned.id, once.id].sort())
      expect((await tasks.get(owner.id)).inputs).toMatchObject([{ fileId: pinned.id, weight: 'reference' }])
      expect(record.inputs.map((item) => [item.fileId, item.oneShot])).toEqual([[pinned.id, false], [once.id, true]])
      const next = await completed(thread.id, '다음 턴')
      expect(next.record.inputs.map((item) => item.fileId)).toEqual([pinned.id]) // 고정 첨부만 다음 턴에도 간다
    })

    it('U-04 크기 한도를 넘는 업로드·산출물 저장은 413이고 흔적을 남기지 않는다', async () => {
      const owner = (await tasks.create('member', { assistantId })).task
      await expect(files.upload('member', owner.id, 'big.txt', 'text/plain', Buffer.alloc(1025))).rejects.toMatchObject({ status: 413 })
      await expect(files.saveOutput('member', owner.id, 'big.md', 'a'.repeat(1025))).rejects.toMatchObject({ status: 413 })
      expect(await files.filesForTask(owner.id)).toEqual([])
      await files.upload('member', owner.id, 'max.txt', 'text/plain', Buffer.alloc(1024))
    })

    it('U-05 요청당 첨부 개수 한도를 넘으면 추정·전송 모두 413이고 메시지가 남지 않는다', async () => {
      const { task: owner, thread } = await tasks.create('member', { assistantId })
      const ids = []
      for (const index of [0, 1, 2]) ids.push((await files.upload('member', owner.id, `n${index}.txt`, 'text/plain', text(String(index)))).id)
      await expect(requests.estimate('member', thread.id, { draft: 'x', attachmentIds: ids })).rejects.toMatchObject({ status: 413, response: { code: 'ATTACHMENT_LIMIT' } })
      await expect(requests.start('member', thread.id, { content: 'x', attachmentIds: ids }, 'limit-key')).rejects.toMatchObject({ status: 413 })
      expect(await tasks.messages(thread.id)).toEqual([])
      expect((await requests.estimate('member', thread.id, { draft: 'x', attachmentIds: ids.slice(0, 2) })).attachmentLimit).toBe(2)
    })

    it('U-06 한글·공백·이모지 파일명은 그대로 저장되고 Windows 금지 문자·예약어·경로는 거부된다', async () => {
      const owner = (await tasks.create('member', { assistantId })).task
      for (const name of ['알람_이력_0901.csv', '설비 점검표.txt', '메모 🙂.md', 'a.b.c.TXT']) {
        const file = await files.upload('member', owner.id, name, 'text/plain', text(name))
        expect(file.name).toBe(name)
        expect((await files.get(file.id, 'member')).name).toBe(name)
        expect((await files.versions(file.id, 'member')).map((item) => item.name)).toEqual([name])
      }
      expect((await files.filesForTask(owner.id)).map((item) => item.name)).toEqual(['알람_이력_0901.csv', '설비 점검표.txt', '메모 🙂.md', 'a.b.c.TXT'])
      for (const name of ['a:b.txt', 'CON.txt', 'con', 'LPT1.md', 'a/b.txt', 'a\\b.txt', 'trailing.', 'trailing ', 'q?.txt', '<x>.txt', '.', '..', ' ', `${'x'.repeat(252)}.txt`]) {
        await expect(files.upload('member', owner.id, name, 'text/plain', text('x')), name).rejects.toMatchObject({ status: 400 })
        await expect(files.saveOutput('member', owner.id, name, '# x'), name).rejects.toMatchObject({ status: 400 })
      }
      expect((await files.filesForTask(owner.id)).length).toBe(4)
    })

    it('U-08 삭제된 대화·다른 요청자의 SR에는 첨부할 수 없다', async () => {
      const owner = (await tasks.create('member', { assistantId })).task
      await tasks.delete(owner.id, 'member')
      await expect(files.upload('member', owner.id, 'x.txt', 'text/plain', text('x'))).rejects.toMatchObject({ status: 404 })
      const draft = await sr.create('member')
      const attached = await files.uploadSr('member', draft.id, '요청 첨부.txt', 'text/plain', text('sr'))
      expect(attached).toMatchObject({ originSrId: draft.id, name: '요청 첨부.txt', version: 1 })
      await expect(files.uploadSr('other', draft.id, 'x.txt', 'text/plain', text('x'))).rejects.toMatchObject({ status: 403 })
      await expect(files.uploadSr('member', draft.id, 'a:b.txt', 'text/plain', text('x'))).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('AI 응답 파일', () => {
    it('A-01 산출물로 저장한 파일은 업로드 파일과 같은 길(자료함·입력 선택·태그 공유·버전·다운로드)을 간다', async () => {
      const tag = `out-${uid()}`
      const source = (await tasks.create('member', { assistantId, tags: [tag] })).task
      const consumer = (await tasks.create('member', { assistantId, tags: [tag] })).task
      const v1 = await files.saveOutput('member', source.id, '답변_정리.md', '# 첫 답변')
      expect(v1).toMatchObject({ source: 'assistant', isOutput: true, mime: 'text/markdown', version: 1, size: Buffer.byteLength('# 첫 답변') })
      expect((await tasks.get(source.id)).outputFileIds).toEqual([v1.id])
      expect((await files.candidates(consumer.id)).files.find((item) => item.file.id === v1.id)).toMatchObject({ role: 'output', sourceCode: source.code, viaTags: [tag] })
      await files.setInput('member', consumer.id, v1.id, 'main')
      expect(Buffer.from(await files.content(v1.id, 'other')).toString()).toBe('# 첫 답변')
      const v2 = await files.saveOutput('member', source.id, '답변_정리.md', '# 둘째 답변')
      expect(v2).toMatchObject({ version: 2, previousId: v1.id, isOutput: true })
      expect((await tasks.get(source.id)).outputFileIds).toEqual([v2.id])
      expect((await files.versions(v2.id, 'member')).map((item) => item.version)).toEqual([2, 1])
      const threadId = (await tasks.get(consumer.id)).threadId!
      const { record } = await completed(threadId, '정리본으로')
      expect(record.inputs).toMatchObject([{ fileId: v1.id, fileVersion: 1, weight: 'main', delivery: 'inline', sourceLabel: `답변_정리.md · ${source.code} · ${assistantName}` }])
      // 업로드를 산출물로 표시한 파일도 같은 role로 보인다
      const marked = await files.upload('member', source.id, 'manual.txt', 'text/plain', text('m'), true)
      expect((await files.candidates(consumer.id)).files.find((item) => item.file.id === marked.id)).toMatchObject({ role: 'output' })
      await files.setOutput('member', marked.id, false)
      expect((await files.candidates(consumer.id)).files.find((item) => item.file.id === marked.id)).toMatchObject({ role: 'upload' })
      expect((await db.select().from(taskInput).where(eq(taskInput.taskId, consumer.id))).map((row) => row.fileId)).toEqual([v1.id])
    })
  })
})
