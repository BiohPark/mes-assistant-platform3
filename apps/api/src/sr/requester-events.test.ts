import 'reflect-metadata'
import { EventEmitter } from 'node:events'
import { ForbiddenException, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Response } from 'express'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionGuard, type AuthedRequest } from '../auth/guards.js'
import type { AuthUser, SessionStore } from '../auth/session.service.js'
import type { Db } from '../db/db.module.js'
import { appUser } from '../db/schema.js'
import { EventsController } from '../events/events.controller.js'
import { EventsService } from '../events/events.service.js'

vi.mock('./access.js', () => ({
  assertSrAccess: vi.fn(async (_db: Db, _actor: string, srId: string) => {
    if (srId !== 'own-sr') throw new ForbiddenException('자신의 SR만 볼 수 있습니다')
  }),
}))

afterEach(() => vi.clearAllMocks())

const bo: AuthUser = { id: 'bo', name: 'BO', role: '', theme: 'system', locale: 'ko', isBusinessOwner: true, isSystemOwner: false }

async function authorize(method: string, path: string, user: AuthUser | null = bo) {
  const req = { method, path, cookies: { mes_session: 'session' } } as unknown as AuthedRequest
  const guard = new SessionGuard(new Reflector(), { resolve: async () => user } as unknown as SessionStore)
  const context = { getHandler: () => authorize, getClass: () => SessionGuard,
    switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext
  return guard.canActivate(context)
}

it('allows a BO to subscribe to GET /api/events for SR library updates', async () => {
  await expect(authorize('GET', '/api/events')).resolves.toBe(true)
})

it('keeps events authenticated and does not expand other BO routes', async () => {
  await expect(authorize('GET', '/api/events', null)).rejects.toMatchObject({ status: 401 })
  await expect(authorize('POST', '/api/events')).rejects.toMatchObject({ status: 403 })
  await expect(authorize('GET', '/api/tasks')).rejects.toMatchObject({ status: 403 })
  await expect(authorize('GET', '/api/events', { ...bo, mustChangePassword: true })).rejects.toMatchObject({ status: 403 })
})

it.each(['live', 'replay'] as const)('delivers only own SR events and notifications to a BO on %s', async delivery => {
  // The stream must also hide ordinary task events once the session guard lets BOs connect.
  const where = vi.fn()
  for (let i = 0; i < 3; i++) {
    where.mockResolvedValueOnce([{ srId: 'own-sr' }]).mockResolvedValueOnce([{ srId: 'other-sr' }])
      .mockResolvedValueOnce([{ srId: null }]).mockResolvedValueOnce([])
  }
  const db = { select: () => ({ from: (table: unknown) => ({ where: table === appUser
    ? async () => [{ ...bo, active: true, mustChangePassword: false }] : where }) }) } as unknown as Db
  const events = new EventsService(), controller = new EventsController(events, db)
  const stream = new EventEmitter() as EventEmitter & Pick<Response, 'status' | 'set' | 'flushHeaders' | 'write'>
  stream.status = vi.fn(() => stream) as unknown as Response['status']
  stream.set = vi.fn(() => stream) as unknown as Response['set']
  stream.flushHeaders = vi.fn()
  const write = vi.fn<(chunk: string) => boolean>(() => true)
  stream.write = write as Response['write']
  const cursor = events.cursor()
  const open = () => controller.stream({ user: bo } as AuthedRequest, stream as unknown as Response, cursor)
  try {
    if (delivery === 'live') await open()
    events.publish('sr.updated', { srId: 'own-sr' })
    events.publish('sr.updated', { srId: 'other-sr' })
    for (const event of ['message.appended', 'request.updated', 'presence.typing'] as const) {
      for (const threadId of ['own-thread', 'other-thread', 'task-thread', 'missing-thread']) {
        if (event === 'message.appended') events.publish(event, { threadId, taskId: '', messageId: 'message' })
        else if (event === 'request.updated') events.publish(event, { threadId, taskId: null, requestId: 'request', status: 'succeeded' })
        else events.typing(threadId, 'owner', 'Owner')
      }
    }
    events.publish('task.created', { taskId: 'internal', assistantId: 'assistant' })
    events.publish('task.updated', { taskId: 'internal' })
    for (const event of ['file.updated', 'input.updated', 'context.updated', 'brief.updated'] as const) events.publish(event, { taskId: 'internal' })
    events.publish('notification.created', { userId: 'someone-else', id: 'private-notification' })
    const barrier = events.publish('notification.created', { userId: bo.id, id: 'own-notification' })
    if (delivery === 'replay') await open()
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith(expect.stringContaining(`id: ${barrier.id}\n`)))
    const received = write.mock.calls.map(([chunk]) => chunk)
    expect(received).toHaveLength(5)
    expect(received[0]).toContain('event: sr.updated\ndata: {"srId":"own-sr"}')
    expect(received.slice(1, 4).every(chunk => chunk.includes('"threadId":"own-thread"'))).toBe(true)
    expect(received[4]).toContain('own-notification')
    expect(where).toHaveBeenCalledTimes(12)
  } finally { stream.emit('close') }
})
