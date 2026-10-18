import { EventEmitter } from 'node:events'
import type { Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { EventsController } from './events.controller.js'
import { EventsService } from './events.service.js'
import type { Db } from '../db/db.module.js'
import { appUser } from '../db/schema.js'

const actor = { user: { id: 'u', isBusinessOwner: false, isSystemOwner: false } } as never
const currentUser = { active: true, mustChangePassword: false, isBusinessOwner: false, isSystemOwner: false }
function roleDb(user: () => typeof currentUser | undefined = () => currentUser) {
  return { select: () => ({ from: (table: unknown) => ({ where: async () => {
    const current = user()
    return table === appUser ? (current ? [{ ...current }] : []) : [{ srId: null }]
  } }) }) } as unknown as Db
}
const memberDb = roleDb()

function response(write: (chunk: string) => boolean = () => true) {
  const stream = new EventEmitter() as EventEmitter & { status: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>;
    flushHeaders: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  stream.status = vi.fn(() => stream)
  stream.set = vi.fn(() => stream)
  stream.flushHeaders = vi.fn()
  stream.write = vi.fn(write)
  stream.end = vi.fn(() => stream.emit('close'))
  return stream
}

describe('events HTTP stream', () => {
  it.each([
    { label: 'SO/BO loses SO', isSystemOwner: true, isBusinessOwner: true },
    { label: 'ordinary member becomes BO', isSystemOwner: false, isBusinessOwner: false },
  ].flatMap(roles => (['live', 'replay'] as const).map(delivery => ({ ...roles, delivery }))))(
    'applies current requester scope on $delivery when $label', async roles => {
    let user = { ...currentUser, isSystemOwner: roles.isSystemOwner, isBusinessOwner: roles.isBusinessOwner }
    const events = new EventsService(), controller = new EventsController(events, roleDb(() => user))
    const sessionActor = { user: { id: 'u', ...user } } as never
    const initial = response(), reconnect = response()
    let stream = initial
    const publish = () => {
      events.publish('task.created', { taskId: 'hidden-task', assistantId: 'hidden-assistant' })
      for (const event of ['task.updated', 'file.updated', 'input.updated', 'context.updated', 'brief.updated'] as const) {
        events.publish(event, { taskId: 'hidden-task' })
      }
      events.publish('message.appended', { threadId: 'hidden-thread', taskId: 'hidden-task', messageId: 'hidden-message' })
      events.publish('request.updated', { threadId: 'hidden-thread', taskId: 'hidden-task', requestId: 'hidden-request', status: 'pending' })
      events.typing('hidden-thread', 'hidden-user', 'hidden-name')
      return events.publish('notification.created', { userId: 'u', id: 'own' })
    }
    try {
      await controller.stream(sessionActor, initial as unknown as Response, events.cursor())
      events.publish('task.updated', { taskId: 'before' })
      await vi.waitFor(() => expect(initial.write.mock.calls.flat().join('')).toContain('before'))
      initial.write.mockClear()
      const cursor = events.cursor()
      let stored: ReturnType<typeof publish> | undefined
      if (roles.delivery === 'replay') { initial.emit('close'); stored = publish() }
      user = { ...user, isBusinessOwner: true, isSystemOwner: false }
      const barrier = stored ?? publish()
      if (roles.delivery === 'replay') {
        stream = reconnect
        await controller.stream(sessionActor, reconnect as unknown as Response, cursor)
      }
      await vi.waitFor(() => expect(stream.write.mock.calls.flat().join('')).toContain(barrier.id))
      expect(stream.write.mock.calls).toHaveLength(1)
      expect(stream.write.mock.calls.flat().join('')).not.toContain('hidden')
    } finally { initial.emit('close'); reconnect.emit('close') }
  })

  it.each(['inactive', 'missing', 'password-change'] as const)('closes an existing stream before delivering data for an %s account', async state => {
    let user: typeof currentUser | undefined = { ...currentUser }
    const events = new EventsService(), controller = new EventsController(events, roleDb(() => user))
    const stream = response()
    try {
      await controller.stream(actor, stream as unknown as Response, events.cursor())
      user = state === 'missing' ? undefined : { ...currentUser, active: state !== 'inactive', mustChangePassword: state === 'password-change' }
      events.publish('task.updated', { taskId: 'secret' })
      await vi.waitFor(() => expect(stream.end).toHaveBeenCalledTimes(1))
      expect(stream.write).not.toHaveBeenCalled()
    } finally { stream.emit('close') }
  })

  it('sends an initial cursor so reconnect can replay a change before the first live event', async () => {
    const events = new EventsService(), controller = new EventsController(events, memberDb)
    const first = response()
    await controller.stream(actor, first as unknown as Response)
    const initial = first.write.mock.calls[0]![0] as string
    const cursor = initial.match(/^id: (.+)$/m)?.[1]
    expect(initial).toContain('event: resync')
    expect(cursor).toBeTruthy()
    first.emit('close')
    const changed = events.publish('task.updated', { taskId: 't' })
    const second = response()
    await controller.stream(actor, second as unknown as Response, cursor)
    expect(second.write).toHaveBeenCalledWith(`id: ${changed.id}\nevent: task.updated\ndata: {"taskId":"t"}\n\n`)
    second.emit('close')
  })

  it('closes and unsubscribes a slow client when writing an event hits backpressure', async () => {
    const events = new EventsService(), controller = new EventsController(events, memberDb)
    const stream = response(() => false)
    await controller.stream(actor, stream as unknown as Response, events.cursor())
    events.publish('task.updated', { taskId: 't' })
    await vi.waitFor(() => expect(stream.end).toHaveBeenCalledTimes(1))
    const writes = stream.write.mock.calls.length
    events.publish('task.updated', { taskId: 'again' })
    expect(stream.write).toHaveBeenCalledTimes(writes)
  })

  it('no duplicate after resync for an event already covered by the resync cursor', async () => {
    const events = new EventsService(), controller = new EventsController(events, memberDb)
    const replay = events.replay.bind(events)
    vi.spyOn(events, 'replay').mockImplementationOnce((cursor) => {
      events.publish('task.updated', { taskId: 'covered' })
      return replay(cursor)
    })
    const stream = response()
    await controller.stream(actor, stream as unknown as Response, 'old-boot:1')
    expect(stream.write.mock.calls.flat().join('')).toContain('event: resync')
    expect(stream.write.mock.calls.flat().join('')).not.toContain('covered')
    const cursor = (stream.write.mock.calls[0]![0] as string).match(/^id: (.+)$/m)![1]!
    stream.emit('close')
    const reconnect = response()
    await controller.stream(actor, reconnect as unknown as Response, cursor)
    expect(reconnect.write).not.toHaveBeenCalled()
    events.publish('task.updated', { taskId: 'new' })
    await vi.waitFor(() => expect(reconnect.write).toHaveBeenCalledTimes(1))
    reconnect.emit('close')
  })

})
