import { describe, it, expect } from 'vitest'
import { EMPTY_FILTER, filterFromParams, filterToParams, isFiltering, kanbanColumns, stageOptions } from './kanban.js'
import type { Assistant, Task } from './types.js'

const asst = (id: string, order: number, level1: string, level2: string, status: Assistant['status'] = 'open') => ({ id, order, level1, level2, status }) as Assistant
const assistants = [asst('cca', 3, 'Record', 'CCA'), asst('urs', 1, 'SDLC', '분석'), asst('fds', 2, 'SDLC', '설계'), asst('old', 4, 'SDLC', '분석', 'retired')]
const task = (id: string, assistantId: string, extra: Partial<Task> = {}) =>
  ({ id, code: id, assistantId, title: id, summary: '', status: 'in_progress', ownerId: 'u1', assigneeIds: [], tags: [], lastActivityAt: '2026-09-01', ...extra }) as Task

describe('kanbanColumns', () => {
  it('orders columns by assistant order and cards by recent activity', () => {
    const tasks = [task('a', 'fds', { lastActivityAt: '2026-09-01' }), task('b', 'fds', { lastActivityAt: '2026-09-05' })]
    const cols = kanbanColumns(assistants, tasks, EMPTY_FILTER)
    expect(cols.map((c) => c.assistant.id)).toEqual(['urs', 'fds', 'cca'])
    expect(cols[1].tasks.map((t) => t.id)).toEqual(['b', 'a'])
  })
  it('stage filter narrows columns; status/tag/mine narrow cards', () => {
    const tasks = [
      task('a', 'urs', { tags: ['SR-2026-0002'] }),
      task('b', 'urs', { status: 'done', tags: ['sr-2026-0002'] }),
      task('c', 'fds', { ownerId: 'u2' }),
    ]
    const f = { ...EMPTY_FILTER, stages: ['SDLC/분석', 'SDLC/설계'], statuses: ['in_progress' as const], tags: ['SR-2026-0002'] }
    const cols = kanbanColumns(assistants, tasks, f)
    expect(cols.map((c) => c.assistant.id)).toEqual(['urs', 'fds'])
    expect(cols[0].tasks.map((t) => t.id)).toEqual(['a'])
    expect(cols[1].tasks).toEqual([])
    expect(kanbanColumns(assistants, tasks, { ...EMPTY_FILTER, mine: true }, 'u2').flatMap((c) => c.tasks.map((t) => t.id))).toEqual(['c'])
  })
  it('shows retired columns only when they still have conversations', () => {
    expect(kanbanColumns(assistants, [], EMPTY_FILTER).some((c) => c.assistant.id === 'old')).toBe(false)
    expect(kanbanColumns(assistants, [task('x', 'old')], EMPTY_FILTER).some((c) => c.assistant.id === 'old')).toBe(true)
  })
})

describe('filters', () => {
  it('round-trips through URL params and keeps unrelated keys', () => {
    const f = { stages: ['SDLC/설계'], statuses: ['todo' as const], tags: ['SR-2026-0002'], mine: true, assistantId: 'fds', q: 'alarm' }
    const p = filterToParams(f, new URLSearchParams('view=kanban&status=bogus'))
    expect(p.get('view')).toBe('kanban')
    expect(filterFromParams(p)).toEqual(f)
    expect(isFiltering(EMPTY_FILTER)).toBe(false)
    expect(isFiltering(f)).toBe(true)
  })
  it('stageOptions groups Lv2 under Lv1 in common order', () => {
    expect(stageOptions(assistants)).toEqual([
      { level1: 'SDLC', stages: [{ key: 'SDLC/분석', level2: '분석' }, { key: 'SDLC/설계', level2: '설계' }] },
      { level1: 'Record', stages: [{ key: 'Record/CCA', level2: 'CCA' }] },
    ])
  })
})
