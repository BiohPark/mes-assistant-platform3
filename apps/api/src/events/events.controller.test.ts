import { EventEmitter } from 'node:events'
import type { Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { EventsController } from './events.controller.js'
import { EventsService } from './events.service.js'
import type { Db } from '../db/db.module.js'

const actor = { user: { id: 'u' } } as never
const unusedDb = {} as Db

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
  it('sends an initial cursor so reconnect can replay a change before the first live event', async () => {
    const events = new EventsService(), controller = new EventsController(events, unusedDb)
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
    const events = new EventsService(), controller = new EventsController(events, unusedDb)
    const stream = response(() => false)
    await controller.stream(actor, stream as unknown as Response, events.cursor())
    events.publish('task.updated', { taskId: 't' })
    await vi.waitFor(() => expect(stream.end).toHaveBeenCalledTimes(1))
    const writes = stream.write.mock.calls.length
    events.publish('task.updated', { taskId: 'again' })
    expect(stream.write).toHaveBeenCalledTimes(writes)
  })
})
