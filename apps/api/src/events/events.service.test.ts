import { describe, expect, it, vi } from 'vitest'
import { EventsService } from './events.service.js'

describe('EventsService replay', () => {
  it('replays newer events and resyncs after a foreign boot or expired cursor', () => {
    vi.useFakeTimers()
    try {
      const events = new EventsService()
      const first = events.publish('task.updated', { taskId: 't1' })
      events.publish('file.updated', { taskId: 't1' })
      expect(events.replay(first.id).events.map((event) => event.event)).toEqual(['file.updated'])
      expect(events.replay('different:1').resync).toBe(true)
      vi.advanceTimersByTime(5 * 60_000 + 1)
      expect(events.replay(first.id).resync).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it('retains only the latest 1000 events', () => {
    const events = new EventsService()
    const first = events.publish('task.updated', { taskId: '0' })
    for (let i = 1; i <= 1001; i++) events.publish('task.updated', { taskId: String(i) })
    expect(events.replay(first.id).resync).toBe(true)
  })

  it('sets typing presence to five seconds after publication', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'))
      const event = new EventsService().typing('thread', 'user', '이름')
      expect(event).toMatchObject({ event: 'presence.typing', data: { threadId: 'thread', userId: 'user', name: '이름', until: '2026-10-01T00:00:05.000Z' } })
    } finally { vi.useRealTimers() }
  })

  it('keeps publishing when a disconnected listener throws', () => {
    const events = new EventsService()
    events.subscribe(() => { throw new Error('closed') })
    expect(() => events.publish('task.updated', { taskId: 't' })).not.toThrow()
    expect(events.replay(events.cursor()).events).toEqual([])
  })
})
