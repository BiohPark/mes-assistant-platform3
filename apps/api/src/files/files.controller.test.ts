import 'reflect-metadata'
import { BadRequestException, NotFoundException, type INestApplication } from '@nestjs/common'
import { Readable } from 'node:stream'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApp } from '../app.factory.js'
import { AppModule } from '../app.module.js'
import { OIDC } from '../auth/oidc.service.js'
import { SESSION_STORE } from '../auth/session.service.js'
import { USER_DIRECTORY } from '../auth/users.service.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { HEALTH_PROBE } from '../health/health.controller.js'
import { DbFilesService, validName } from './files.service.js'
import { contentDisposition } from './files.controller.js'

const config = loadConfig({ DATABASE_URL: 'mysql://u:p@localhost:1/none', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', AUTH_MODE: 'local', FILE_MAX_BYTES: '12000000' })
const meta = { id: 'f', name: '한글?.txt', mime: 'text/plain', size: 3, version: 1, isOutput: false }

describe('files HTTP API', () => {
  let app: INestApplication
  const service = {
    upload: vi.fn(async () => meta), uploadSr: vi.fn(async () => meta), get: vi.fn(async () => meta), content: vi.fn(async () => Buffer.from('abc')),
    contentStream: vi.fn(async () => Readable.from([Buffer.from('abc')])),
    versions: vi.fn(async () => [meta]), setOutput: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
    saveOutput: vi.fn(async () => meta), setInput: vi.fn(async () => undefined), switchInputVersion: vi.fn(async () => undefined),
    candidates: vi.fn(async () => ({ files: [], conversations: [] })), filesForTask: vi.fn(async () => [meta]),
  }
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config).overrideProvider(DbFilesService).useValue(service)
      .overrideProvider(HEALTH_PROBE).useValue(async () => true)
      .overrideProvider(SESSION_STORE).useValue({ resolve: async (token: string) => token === 'member' ? { id: 'u', name: '사용자', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: false } : null })
      .overrideProvider(OIDC).useValue({}).overrideProvider(USER_DIRECTORY).useValue({}).compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.init()
  })
  afterEach(async () => { await app.close(); vi.clearAllMocks() })
  const auth = () => ({ Cookie: 'mes_session=member' })

  it('requires login, accepts multipart, and rejects files above configured limit', async () => {
    await request(app.getHttpServer()).post('/api/files').field('originTaskId', 't').attach('file', Buffer.from('abc'), 'x.txt').expect(401)
    await request(app.getHttpServer()).post('/api/files').set(auth()).field('originTaskId', 't').attach('file', Buffer.from('abc'), 'x.txt').expect(201)
    expect(service.upload).toHaveBeenCalledWith('u', 't', 'x.txt', 'text/plain', expect.any(Buffer))
    await request(app.getHttpServer()).post('/api/files').set(auth()).field('originTaskId', 't').field('isOutput', 'true').attach('file', Buffer.from('abc'), 'x.txt').expect(201)
    expect(service.upload).toHaveBeenCalledWith('u', 't', 'x.txt', 'text/plain', expect.any(Buffer), true)
    await request(app.getHttpServer()).post('/api/files').set(auth()).field('originTaskId', 't').attach('file', Buffer.alloc(12000001), 'x.txt').expect(413)
  })

  it.each(['알람_이력_0901.csv', '설비 점검표.txt', '메모 🙂.md'])('keeps the UTF-8 multipart filename %s on task and SR uploads', async (name) => {
    await request(app.getHttpServer()).post('/api/files').set(auth()).field('originTaskId', 't').attach('file', Buffer.from('abc'), { filename: name, contentType: 'text/plain' }).expect(201)
    expect(service.upload).toHaveBeenLastCalledWith('u', 't', name, 'text/plain', expect.any(Buffer))
    await request(app.getHttpServer()).post('/api/service-requests/sr/files').set(auth()).attach('file', Buffer.from('abc'), { filename: name, contentType: 'text/plain' }).expect(201)
    expect(service.uploadSr).toHaveBeenLastCalledWith('u', 'sr', name, 'text/plain', expect.any(Buffer))
  })

  it.each([
    ['알람_이력_0901.csv', true], ['설비 점검표.txt', true], ['메모 🙂.md', true], ['a.b.c.TXT', true],
    ['a:b.txt', false], ['q?.txt', false], ['<x>.txt', false], ['a|b.txt', false], ['"x".txt', false], ['a*b.txt', false],
    ['CON.txt', false], ['con', false], ['LPT1.md', false], ['nul.csv', false], ['a/b.txt', false], ['a\\b.txt', false],
    ['trailing.', false], ['trailing ', false], ['.', false], ['..', false], ['', false], ['  ', false], ['tab\t.txt', false], [`${'x'.repeat(252)}.txt`, false],
  ])('validates the stored file name %j → %s', (name, ok) => {
    if (ok) expect(validName(name)).toBe(name)
    else expect(() => validName(name)).toThrow(BadRequestException)
  })

  it('sanitizes the ASCII fallback and percent-encodes RFC 5987 punctuation', () => {
    expect(contentDisposition('CON.txt', false)).toContain('filename="_CON.txt"')
    expect(contentDisposition("CON's.txt", false)).toContain('filename="CON\'s.txt"')
    expect(contentDisposition("CON's.txt", false)).toContain("filename*=UTF-8''CON%27s.txt")
  })

  it.each([
    ['CON.txt', '_CON.txt'], ['a:b.md', 'a_b.md'], ['이름.txt', '이름.txt'], ['설비 점검표.txt', '설비 점검표.txt'], ['메모 🙂.md', '메모 🙂.md'],
  ])('uses one safe name in both disposition parameters for %s', (input, safe) => {
    const header = contentDisposition(input, false)
    expect(header).toContain(`filename="${safe.replace(/[^\x20-\x7e]/g, '_')}"`)
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent(safe)}`)
  })

  it('encodes UTF-8 names in download headers and routes selection', async () => {
    const response = await request(app.getHttpServer()).get('/api/files/f/content').set(auth()).expect(200)
    expect(response.headers['content-disposition']).toContain("filename*=UTF-8''%ED%95%9C%EA%B8%80_.txt")
    expect(response.headers['content-disposition']).toContain('filename="')
    await request(app.getHttpServer()).put('/api/tasks/t/inputs/f').set(auth()).send({ weight: 'main' }).expect(204)
    expect(service.setInput).toHaveBeenCalledWith('u', 't', 'f', 'main')
    await request(app.getHttpServer()).post('/api/tasks/t/inputs/f/switch-version').set(auth()).send({ toFileId: 'v2' }).expect(204)
    expect(service.switchInputVersion).toHaveBeenCalledWith('u', 't', 'f', 'v2')
    await request(app.getHttpServer()).get('/api/tasks/t/candidates').set(auth()).expect(200, { files: [], conversations: [] })
  })

  it('serves HTML attachments as downloads even when named like a text file', async () => {
    service.get.mockResolvedValueOnce({ ...meta, name: 'unsafe.txt', mime: 'text/html' })
    const response = await request(app.getHttpServer()).get('/api/files/f/content').set(auth()).expect(200)
    expect(response.headers['content-disposition']).toMatch(/^attachment;/)
  })

  it('accepts markdown output content within the configured file limit', async () => {
    const content = 'a'.repeat(10000000)
    await request(app.getHttpServer()).post('/api/tasks/t/outputs').set(auth()).send({ name: 'large.md', content }).expect(201)
    expect(service.saveOutput).toHaveBeenCalledWith('u', 't', 'large.md', content)
  })

  it('keeps the ordinary JSON limit for other routes', async () => {
    await request(app.getHttpServer()).post('/api/tasks').set(auth()).send({ content: 'a'.repeat(2000000) }).expect(413)
    await request(app.getHttpServer()).post('/api/tasks/t/outputs').send({ name: 'large.md', content: 'a'.repeat(10000000) }).expect(401)
  })

  it('streams a large download and maps missing content to 404', async () => {
    const bytes = Buffer.alloc(3000000, 42)
    service.get.mockResolvedValueOnce({ ...meta, size: bytes.length })
    service.contentStream.mockResolvedValueOnce(Readable.from([bytes]))
    const response = await request(app.getHttpServer()).get('/api/files/f/content').set(auth()).expect(200)
    expect(response.headers['content-length']).toBe(String(bytes.length))
    expect(Buffer.from(response.text).equals(bytes)).toBe(true)
    service.contentStream.mockRejectedValueOnce(new NotFoundException())
    await request(app.getHttpServer()).get('/api/files/f/content').set(auth()).expect(404)
  })
})
