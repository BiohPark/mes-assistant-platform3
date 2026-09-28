import { describe, it, expect } from 'vitest'
import { applyTaskStatus, checklistProgress, missingRequiredChecklist, toggleChecklistItem } from './transitions.js'
import type { Task } from './types.js'

const base: Task = {
  id: 't1',
  code: 'WK-2026-0001',
  assistantId: 'a1',
  title: 'x',
  titleSource: 'default',
  summary: '',
  status: 'todo',
  ownerId: 'u1',
  assigneeIds: [],
  priority: 'normal',
  tags: [],
  checklist: [
    { id: 'c1', label: 'A', required: true, checked: false },
    { id: 'c2', label: 'B', required: false, checked: true, checkedBy: 'u1', checkedAt: '2026-01-01T00:00:00.000Z' },
  ],
  inputs: [],
  outputFileIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'u1',
}
const at = '2026-02-01T00:00:00.000Z'

describe('applyTaskStatus', () => {
  it('todo → in_progress sets startedAt once', () => {
    const t = applyTaskStatus(base, 'in_progress', 'u1', at)
    expect(t.status).toBe('in_progress')
    expect(t.startedAt).toBe(at)
    expect(applyTaskStatus(t, 'in_progress', 'u1', '2026-03-01T00:00:00.000Z').startedAt).toBe(at)
  })
  it('done sets completedAt/By', () => {
    const t = applyTaskStatus(base, 'done', 'u2', at)
    expect(t.completedAt).toBe(at)
    expect(t.completedBy).toBe('u2')
    expect(t.startedAt).toBe(at)
  })
  it('reopen clears completion', () => {
    const done = applyTaskStatus(base, 'done', 'u2', at)
    const re = applyTaskStatus(done, 'in_progress', 'u1', at)
    expect(re.completedAt).toBeUndefined()
    expect(re.completedBy).toBeUndefined()
  })
  it('does not mutate input', () => {
    applyTaskStatus(base, 'done', 'u1', at)
    expect(base.status).toBe('todo')
  })
})

describe('checklist', () => {
  it('toggle on records who/when, toggle off clears', () => {
    const on = toggleChecklistItem(base, 'c1', 'u1', at)
    expect(on.checklist[0]).toMatchObject({ checked: true, checkedBy: 'u1', checkedAt: at })
    const off = toggleChecklistItem(on, 'c1', 'u1', at)
    expect(off.checklist[0]).toEqual({ id: 'c1', label: 'A', required: true, checked: false })
  })
  it('missingRequired lists unchecked required only', () => {
    expect(missingRequiredChecklist(base).map((c) => c.id)).toEqual(['c1'])
  })
  it('progress counts', () => {
    expect(checklistProgress(base)).toEqual({ done: 1, total: 2 })
  })
})
