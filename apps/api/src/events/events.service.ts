import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'

export type AppEvent =
  | { event: 'task.created'; data: { taskId: string; assistantId: string } }
  | { event: 'task.updated'; data: { taskId: string } }
  | { event: 'message.appended'; data: { threadId: string; taskId: string; messageId: string } }
  | { event: 'request.updated'; data: { requestId: string; threadId: string; taskId: string | null; status: string; phase?: string | null } }
  | { event: 'file.updated'; data: { taskId: string } }
  | { event: 'input.updated'; data: { taskId: string } }
  | { event: 'context.updated'; data: { taskId: string } }
  | { event: 'presence.typing'; data: { threadId: string; userId: string; name: string; until: string } }
  | { event: 'notification.created'; data: Record<string, unknown> }

export type StoredEvent = AppEvent & { id: string; at: number }
const MAX_AGE_MS = 5 * 60_000
const MAX_EVENTS = 1000

@Injectable()
export class EventsService {
  private readonly bootId = randomUUID()
  private seq = 0
  private buffer: StoredEvent[] = []
  private listeners = new Set<(event: StoredEvent) => void>()

  private prune(now = Date.now()) {
    this.buffer = this.buffer.filter((event) => now - event.at <= MAX_AGE_MS).slice(-MAX_EVENTS)
  }

  publish<T extends AppEvent['event']>(event: T, data: Extract<AppEvent, { event: T }>['data']): StoredEvent {
    const record = { id: `${this.bootId}:${++this.seq}`, event, data, at: Date.now() } as StoredEvent
    this.buffer.push(record)
    this.prune(record.at)
    for (const listener of this.listeners) {
      try { listener(record) } catch { this.listeners.delete(listener) }
    }
    return record
  }

  typing(threadId: string, userId: string, name: string): StoredEvent {
    return this.publish('presence.typing', { threadId, userId, name, until: new Date(Date.now() + 5_000).toISOString() })
  }

  replay(lastId?: string): { resync: boolean; events: StoredEvent[] } {
    this.prune()
    if (!lastId) return { resync: false, events: [] }
    const [boot, rawSeq, extra] = lastId.split(':')
    const cursor = Number(rawSeq)
    const first = this.buffer[0]
    if (extra || boot !== this.bootId || !Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.seq ||
      (first ? cursor < Number(first.id.split(':')[1]) - 1 : cursor < this.seq)) return { resync: true, events: [] }
    return { resync: false, events: this.buffer.filter((event) => Number(event.id.split(':')[1]) > cursor) }
  }

  cursor() { return `${this.bootId}:${this.seq}` }

  subscribe(listener: (event: StoredEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
