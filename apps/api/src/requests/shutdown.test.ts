import 'reflect-metadata'
import { Duplex } from 'node:stream'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { expect, it, vi } from 'vitest'
import { AppModule } from '../app.module.js'
import { configureApp } from '../app.factory.js'
import { CONFIG, loadConfig } from '../config/config.js'
import { SESSION_STORE } from '../auth/session.service.js'
import { EventsService } from '../events/events.service.js'
import { DB, type Db } from '../db/db.module.js'
import { SseShutdown } from './sse-shutdown.js'

it.each(['open', 'awaiting-auth'] as const)('shutdown ends an %s /events response and releases its heartbeat and subscription before HTTP disposal', async state => {
  const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173' })
  let allowAuth!: () => void
  const authReady = new Promise<void>(resolve => { allowAuth = resolve })
  const resolveSession = vi.fn(async () => {
    if (state === 'awaiting-auth') await authReady
    return { id: 'u', name: 'User' }
  })
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONFIG).useValue(config)
    .overrideProvider(SESSION_STORE).useValue({ resolve: resolveSession })
    .compile()
  const app = configureApp(module.createNestApplication(), config)
  const socket = new Duplex({ read() {}, write(_chunk, _encoding, done) { done() } })
  try {
    await app.init()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const server = app.getHttpServer() as Server
    let response: ServerResponse | undefined
    server.once('request', (_req, res) => { response = res })
    // Real Node HTTP parsing, Express route, and Nest hooks without opening a TCP port.
    server.emit('connection', socket)
    socket.push('GET /api/events HTTP/1.1\r\nHost: localhost\r\nCookie: mes_session=test\r\n\r\n')
    await vi.waitFor(() => expect(resolveSession).toHaveBeenCalledOnce())
    if (state === 'open') {
      await vi.waitFor(() => expect(response?.headersSent).toBe(true))
      expect(response!.getHeader('content-type')).toContain('text/event-stream')
      expect(vi.getTimerCount()).toBe(1)
    } else expect(response!.headersSent).toBe(false)
    expect(response!.writableEnded).toBe(false)
    const close = vi.fn()
    response!.on('close', close)
    // HTTP disposal waits for SSE connections in a listening server. The hook must end them first.
    const dispose = vi.spyOn(app.getHttpAdapter(), 'close').mockImplementation(async () => {
      // A request admitted before SIGTERM can finish authentication after the shutdown sweep.
      allowAuth()
      await vi.waitFor(() => expect(response!.writableEnded).toBe(true))
    })
    await app.close()
    expect(dispose).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(vi.getTimerCount()).toBe(0)
    // Publishing after shutdown must not invoke the removed subscription's DB read.
    const select = vi.spyOn(app.get<Db>(DB), 'select')
    app.get(EventsService).publish('task.updated', { taskId: 'after-shutdown' })
    await Promise.resolve()
    expect(select).not.toHaveBeenCalled()
  } finally {
    allowAuth()
    socket.destroy()
    await app.close()
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})

it('shutdown lets a pending finite JSON response finish with its original body', async () => {
  let finish!: () => void
  const ready = new Promise<void>(resolve => { finish = resolve })
  let response: ServerResponse | undefined
  let output = ''
  const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { output += chunk.toString(); done() } })
  const server = createServer(async (_req, res) => {
    response = res
    await ready
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"bytes":123}')
  })
  const shutdown = new SseShutdown({ httpAdapter: { getHttpServer: () => server } } as unknown as HttpAdapterHost)
  try {
    shutdown.onModuleInit()
    server.emit('connection', socket)
    socket.push('GET /estimate HTTP/1.1\r\nHost: localhost\r\n\r\n')
    await vi.waitFor(() => expect(response).toBeDefined())
    shutdown.beforeApplicationShutdown()
    expect(response!.writableEnded).toBe(false)
    finish()
    await vi.waitFor(() => expect(response!.writableEnded).toBe(true))
    expect(output).toContain('{"bytes":123}')
  } finally {
    finish()
    socket.destroy()
    shutdown.onApplicationShutdown()
    server.close()
  }
})
