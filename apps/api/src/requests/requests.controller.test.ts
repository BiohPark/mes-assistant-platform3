import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { SESSION_STORE, type SessionStore } from '../auth/session.service.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { RequestsService, type RequestEvent } from './requests.service.js'
import { EventEmitter } from 'node:events'
import type { Response } from 'express'
import { stream, STREAM_HEARTBEAT_MS } from './requests.controller.js'

describe('requests HTTP', () => {
  let app: INestApplication
  const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' })
  const sessions: SessionStore = { create: vi.fn(async () => ({ token: '', expiresAt: new Date() })), resolve: vi.fn(async () => ({ id: 'u', name: 'User', role: '', theme: 'system' as const, locale: 'ko' as const, isSystemOwner: false })), destroy: vi.fn(async () => undefined) }
  const start = vi.fn(async () => ({ id: 'r', userMessageId: 'u1', replyMessageId: 'a1', done: Promise.resolve() }))
  const estimate = vi.fn(async () => ({ bytes: 10, limitBytes: 100, overLimit: false, attachmentLimit: 10, inputs: [] }))
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG).useValue(config)
      .overrideProvider(SESSION_STORE).useValue(sessions)
      .overrideProvider(RequestsService).useValue({ start, estimate, subscribe: (_id: string, listener: (event: unknown) => void) => {
        listener({ event: 'started', data: { requestId: 'r', userMessageId: 'u1', replyMessageId: 'a1' } })
        listener({ event: 'completed', data: { requestInfo: {} } })
        return () => undefined
      } })
      .compile()
    app = configureApp(moduleRef.createNestApplication(), config)
    await app.listen(0, '127.0.0.1')
  })
  afterAll(async () => { await app?.close() })

  it('accepts a recorded over-budget JSON request through the scoped parser', async () => {
    const response = await request(app.getHttpServer()).post('/api/threads/t/requests').set('Cookie', 'mes_session=x')
      .set('Idempotency-Key', 'key').send({ content: 'x'.repeat(270_000) }).expect(201)
    expect(response.headers['content-type']).toMatch(/text\/event-stream/)
    expect(response.text).toContain('event: completed')
    expect(start).toHaveBeenCalledWith('u', 't', { content: 'x'.repeat(270_000) }, 'key')
  })

  it('accepts estimate draft without an idempotency key', async () => {
    const response = await request(app.getHttpServer()).post('/api/threads/t/requests/estimate').set('Cookie', 'mes_session=x')
      .send({ draft: 'x'.repeat(270_000), attachmentIds: [] }).expect(201)
    expect(response.body).toMatchObject({ overLimit: false, attachmentLimit: 10 })
    expect(estimate).toHaveBeenCalledWith('u', 't', { draft: 'x'.repeat(270_000), attachmentIds: [] })
  })
})

it('keeps a silent request stream alive with comment pings and stops them at the end', () => {
  vi.useFakeTimers()
  try {
    const writes: string[] = []
    const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false,
      status() { return this }, set() { return this }, flushHeaders() {}, write(chunk: string) { writes.push(chunk); return true },
      end() { this.writableEnded = true } })
    let listener: ((event: RequestEvent) => void) | undefined
    stream(res as unknown as Response, { subscribe: (_id, next) => { listener = next; return () => { listener = undefined } } }, 'r')
    vi.advanceTimersByTime(STREAM_HEARTBEAT_MS * 2)
    expect(writes).toEqual([': ping\n\n', ': ping\n\n'])
    listener!({ event: 'completed', data: {} })
    vi.advanceTimersByTime(STREAM_HEARTBEAT_MS * 2)
    expect(writes.filter((chunk) => chunk.startsWith(': ping'))).toHaveLength(2)
    expect(res.writableEnded).toBe(true)
    res.emit('close')
    expect(listener).toBeUndefined()
  } finally { vi.useRealTimers() }
})
