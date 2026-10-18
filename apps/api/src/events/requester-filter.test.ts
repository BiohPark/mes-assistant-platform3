import { EventEmitter } from 'node:events'
import type { Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import type { AuthedRequest } from '../auth/guards.js'
import type { Db } from '../db/db.module.js'
import { appUser, serviceRequest, thread } from '../db/schema.js'
import { EventsController } from './events.controller.js'
import { EventsService, type AppEvent } from './events.service.js'

const requester = { id: 'bo', isBusinessOwner: true, isSystemOwner: false }

function database(...rows: unknown[][]) {
  const where = vi.fn()
  for (const result of rows) where.mockResolvedValueOnce(result)
  const from = vi.fn((_table: unknown) => ({ where }))
  return { db: { select: () => ({ from }) } as unknown as Db, from, where }
}

async function replay(event: AppEvent, db: Db, user = requester) {
  const events = new EventsService()
  const cursor = events.cursor()
  const stored = events.publish(event.event, event.data)
  const controller = new EventsController(events, db)
  const stream = new EventEmitter()
  const write = vi.fn(() => true)
  const res = { status: () => res, set: () => res, flushHeaders: () => undefined, write,
    on: stream.on.bind(stream) } as unknown as Response
  try {
    await controller.stream({ user } as AuthedRequest, res, cursor)
    return { writes: write.mock.calls, stored }
  } finally { stream.emit('close') }
}

const ownSr = [{ id: 'own-sr', requesterId: requester.id }]
const otherSr = [{ id: 'other-sr', requesterId: 'other' }]
const boRow = [{ isBusinessOwner: true, isSystemOwner: false }]
const scopedEvents = (threadId: string): AppEvent[] => [
  { event: 'message.appended', data: { threadId, taskId: '', messageId: 'message' } },
  { event: 'request.updated', data: { threadId, taskId: null, requestId: 'request', status: 'succeeded' } },
  { event: 'presence.typing', data: { threadId, userId: 'owner', name: 'Owner', until: '2026-10-18T00:00:00Z' } },
]

describe('requester SSE filter with existing SR access checks', () => {
  it('allows own sr.updated', async () => {
    const { db, from } = database(ownSr)
    const { writes } = await replay({ event: 'sr.updated', data: { srId: 'own-sr' } }, db)
    expect(writes).toHaveLength(1)
    expect(from.mock.calls.map(([table]) => table)).toEqual([serviceRequest])
  })

  it('denies another requester SR before any task access fallback', async () => {
    const { db, from } = database(otherSr, boRow)
    const { writes } = await replay({ event: 'sr.updated', data: { srId: 'other-sr' } }, db)
    expect(writes).toHaveLength(0)
    expect(from.mock.calls.map(([table]) => table)).toEqual([serviceRequest, appUser])
  })

  it('denies a missing SR', async () => {
    const { db } = database([])
    expect((await replay({ event: 'sr.updated', data: { srId: 'missing-sr' } }, db)).writes).toHaveLength(0)
  })

  it.each(scopedEvents('own-thread'))('allows $event in an own SR thread', async event => {
    const { db, from } = database([{ srId: 'own-sr' }], ownSr)
    expect((await replay(event, db)).writes).toHaveLength(1)
    expect(from.mock.calls.map(([table]) => table)).toEqual([thread, serviceRequest])
  })

  it.each(scopedEvents('other-thread'))('denies $event in another SR thread', async event => {
    const { db, from } = database([{ srId: 'other-sr' }], otherSr, boRow)
    expect((await replay(event, db)).writes).toHaveLength(0)
    expect(from.mock.calls.map(([table]) => table)).toEqual([thread, serviceRequest, appUser])
  })

  for (const [label, rows] of [['ordinary', [{ srId: null }]], ['missing', []]] as const) {
    it.each(scopedEvents(`${label}-thread`))(`denies $event in a ${label} thread`, async event => {
      const { db, from } = database([...rows])
      expect((await replay(event, db)).writes).toHaveLength(0)
      expect(from).toHaveBeenCalledTimes(1)
    })
  }

  const internalEvents: AppEvent[] = [
    { event: 'task.created', data: { taskId: 'private', assistantId: 'assistant' } },
    ...(['task.updated', 'file.updated', 'input.updated', 'context.updated', 'brief.updated'] as const)
      .map(event => ({ event, data: { taskId: 'private' } })),
  ]
  it.each(internalEvents)('denies internal $event', async event => {
    const { db, from } = database()
    expect((await replay(event, db)).writes).toHaveLength(0)
    expect(from).not.toHaveBeenCalled()
  })

  it.each([['bo', 1], ['other', 0], [undefined, 0]] as const)('filters notifications addressed to %s', async (userId, count) => {
    const { db } = database()
    expect((await replay({ event: 'notification.created', data: { userId } }, db)).writes).toHaveLength(count)
  })

  it.each([{ ...requester, isBusinessOwner: false }, { ...requester, isSystemOwner: true }])('preserves staff/system-owner events ($isSystemOwner)', async user => {
    const { db } = database([{ srId: null }])
    expect((await replay(scopedEvents('ordinary-thread')[0]!, db, user)).writes).toHaveLength(1)
    expect((await replay(internalEvents[0]!, db, user)).writes).toHaveLength(1)
  })
})
