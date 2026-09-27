import { describe, expect, it } from 'vitest'
import { conversationCandidates, eligibleMessages, newMessagesSince, snapshotMessages } from './conversationContext.js'
import type { Assistant, Message, Task } from './types.js'

const task = (id: string, tags: string[], lastActivityAt: string, assistantId = 'a1'): Task =>
  ({ id, code: id.toUpperCase(), assistantId, tags, lastActivityAt, inputs: [], outputFileIds: [] }) as unknown as Task
const assistants = [{ id: 'a1', name: 'URS', order: 2 } as Assistant, { id: 'a2', name: 'FDS', order: 1 } as Assistant]
const msg = (id: string, createdAt: string, patch: Partial<Message> = {}): Message => ({
  id,
  threadId: 't',
  role: 'user',
  content: id,
  createdAt,
  attachmentIds: [],
  status: 'done',
  ...patch,
})

describe('conversationCandidates', () => {
  it('only conversations that directly share a tag; no self, no transitive A–B–C', () => {
    const a = task('a', ['x'], '2026-01-01')
    const b = task('b', ['x', 'y'], '2026-01-02')
    const c = task('c', ['y'], '2026-01-03')
    expect(conversationCandidates(a, [a, b, c], assistants).map((x) => x.task.id)).toEqual(['b'])
  })

  it('matches tags by normalized key and reports the shared tags', () => {
    const a = task('a', ['SR-2026-0001', 'Alarm Filter'], '2026-01-01')
    const b = task('b', ['sr-2026-0001', 'alarm-filter'], '2026-01-02')
    expect(conversationCandidates(a, [a, b], assistants)[0].viaTags).toEqual(['sr-2026-0001', 'alarm-filter'])
  })

  it('orders by recent activity, not by agent order (no stage meaning)', () => {
    const me = task('me', ['x'], '2026-01-01')
    const older = task('older', ['x'], '2026-01-02', 'a2')
    const newer = task('newer', ['x'], '2026-01-05', 'a1')
    expect(conversationCandidates(me, [me, older, newer], assistants).map((x) => x.task.id)).toEqual(['newer', 'older'])
  })
})

describe('eligibleMessages', () => {
  it('keeps finished user/assistant turns only; drops team notes, system, failed and streaming', () => {
    const rows = [
      msg('u1', '1'),
      msg('a1', '2', { role: 'assistant' }),
      msg('note', '3', { kind: 'discussion' }),
      msg('sys', '4', { role: 'system' }),
      msg('err', '5', { role: 'assistant', status: 'error' }),
      msg('live', '6', { role: 'assistant', status: 'streaming' }),
      msg('empty', '7', { role: 'assistant', content: '  ' }),
    ]
    expect(eligibleMessages(rows).map((m) => m.id)).toEqual(['u1', 'a1'])
  })
})

describe('snapshotMessages / newMessagesSince', () => {
  const rows = [msg('m1', '2026-01-01T00:00:01Z'), msg('m2', '2026-01-01T00:00:02Z', { role: 'assistant' }), msg('m3', '2026-01-01T00:00:03Z')]

  it('returns snapshot messages in time order and ignores ids that no longer exist', () => {
    expect(snapshotMessages(['m3', 'gone', 'm1'], rows).map((m) => m.id)).toEqual(['m1', 'm3'])
  })

  it('counts eligible messages after the snapshot boundary', () => {
    expect(newMessagesSince({ upToMessageId: 'm2', upToCreatedAt: '2026-01-01T00:00:02Z' }, rows)).toBe(1)
    expect(newMessagesSince({ upToMessageId: 'm3', upToCreatedAt: '2026-01-01T00:00:03Z' }, rows)).toBe(0)
    expect(newMessagesSince({}, rows)).toBe(3)
  })
})
