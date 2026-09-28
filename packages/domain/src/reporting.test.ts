import { describe, it, expect } from 'vitest'
import {
  assistantStats,
  completionBuckets,
  feedbackDigest,
  feedbackDigestMarkdown,
  inefficiencySignals,
  inputFlow,
  srLeadDays,
  srStatusDistribution,
  tagUsage,
  userActivityStats,
} from './reporting.js'
import type { ActivityLog, Assistant, ServiceRequest, Task, User } from './types.js'

const now = new Date('2026-09-20T00:00:00.000Z')
const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString()

const task = (id: string, extra: Partial<Task>): Task => ({
  id,
  code: id,
  assistantId: 'a1',
  title: id,
  titleSource: 'default',
  summary: '',
  status: 'todo',
  ownerId: 'u1',
  assigneeIds: [],
  priority: 'normal',
  tags: [],
  checklist: [],
  inputs: [],
  outputFileIds: [],
  createdAt: iso(10),
  lastActivityAt: iso(10),
  createdBy: 'u1',
  ...extra,
})
const assistants = [
  { id: 'a1', name: 'A1', level2: 'L' },
  { id: 'a2', name: 'A2', level2: 'M' },
] as Assistant[]
const users: User[] = [
  { id: 'u1', name: 'U1', role: '', initials: 'U', color: '' },
  { id: 'u2', name: 'U2', role: '', initials: 'U', color: '' },
]
const act = (type: ActivityLog['type'], extra: Partial<ActivityLog> = {}): ActivityLog => ({ id: Math.random().toString(), userId: 'u1', type, payload: {}, at: iso(1), ...extra })

describe('completionBuckets', () => {
  it('counts done tasks per day within window', () => {
    const tasks = [task('t1', { status: 'done', completedAt: iso(1) }), task('t2', { status: 'done', completedAt: iso(40) })]
    const b = completionBuckets(tasks, 7, 'day', now)
    expect(b).toHaveLength(7)
    expect(b.reduce((s, x) => s + x.done, 0)).toBe(1)
  })
})

describe('assistantStats', () => {
  it('computes per-assistant counts, avg lead days, avg rating', () => {
    const tasks = [
      task('t1', { status: 'done', startedAt: iso(9), completedAt: iso(5), feedback: { rating: 5, comment: '', by: 'u1', at: '' } }),
      task('t2', { status: 'in_progress', startedAt: iso(2) }),
      task('t3', { assistantId: 'a2' }),
    ]
    const rows = assistantStats(tasks, assistants, now)
    expect(rows.find((r) => r.assistant.id === 'a1')).toMatchObject({ total: 2, active: 1, done: 1, avgLeadDays: 4, avgRating: 5 })
    expect(rows.find((r) => r.assistant.id === 'a2')).toMatchObject({ total: 1, done: 0, avgLeadDays: undefined })
  })
})

const pick = (fileId: string) => ({ fileId, weight: 'main' as const, selectedAt: iso(3), selectedBy: 'u1' })

describe('inputFlow', () => {
  it('aggregates source assistant → consumer assistant pairs from selected inputs', () => {
    const tasks = [task('t1', { assistantId: 'a1' }), task('t2', { assistantId: 'a2', inputs: [pick('f1')] }), task('t3', { assistantId: 'a2', inputs: [pick('f1'), pick('own')] })]
    const files = [
      { id: 'f1', originTaskId: 't1' },
      { id: 'own', originTaskId: 't3' },
    ]
    expect(inputFlow(tasks, files)).toEqual([{ fromAssistantId: 'a1', toAssistantId: 'a2', count: 2 }])
  })
})

describe('tagUsage', () => {
  it('counts conversations, open ones and distinct assistants per tag', () => {
    const tasks = [
      task('t1', { tags: ['SR-2026-0002'], status: 'done' }),
      task('t2', { tags: ['SR-2026-0002', 'x'], assistantId: 'a2' }),
      task('t3', { tags: ['SR-2026-0002'], assistantId: 'a2' }),
    ]
    expect(tagUsage(tasks)[0]).toEqual({ tag: 'SR-2026-0002', conversations: 3, open: 2, assistantIds: ['a1', 'a2'] })
    expect(tagUsage(tasks)[1].tag).toBe('x')
  })
})

describe('sr', () => {
  const srs = [
    { id: 's1', status: 'draft' },
    { id: 's2', status: 'submitted' },
    { id: 's3', status: 'done', submittedAt: iso(10) },
  ] as ServiceRequest[]
  it('distribution excludes draft', () => {
    expect(srStatusDistribution(srs)).toEqual([
      { status: 'submitted', count: 1 },
      { status: 'reviewing', count: 0 },
      { status: 'in_progress', count: 0 },
      { status: 'responded', count: 0 },
      { status: 'done', count: 1 },
      { status: 'rejected', count: 0 },
    ])
  })
  it('lead days uses submitted → done status change', () => {
    const activity = [act('sr.status_changed', { srId: 's3', payload: { to: 'done' }, at: iso(4) })]
    expect(srLeadDays(srs, activity)).toBe(6)
  })
})

describe('inefficiencySignals', () => {
  it('flags reopen, missing_required, long_task, stale, outdated_input', () => {
    const tasks = [
      task('long', { status: 'in_progress', startedAt: iso(12) }),
      task('stale', { status: 'in_progress', startedAt: iso(2) }),
      task('outdated', { status: 'todo', inputs: [pick('v1')] }),
      task('fresh', { status: 'in_progress', startedAt: iso(1) }),
    ]
    const activity = [
      act('task.reopened', { taskId: 'fresh' }),
      act('task.completed', { taskId: 'fresh', payload: { missingRequired: 2 } }),
      act('message.sent', { taskId: 'stale', at: iso(6) }),
      act('message.sent', { taskId: 'fresh', at: iso(0) }),
      act('message.sent', { taskId: 'long', at: iso(0) }),
    ]
    const files = [
      { id: 'v1', name: 'URS.md', version: 1 },
      { id: 'v2', name: 'URS.md', version: 2, previousId: 'v1' },
    ]
    const kinds = inefficiencySignals(tasks, activity, files, now).map((s) => `${s.kind}:${s.taskId}`)
    expect(kinds).toContain('reopen:fresh')
    expect(kinds).toContain('missing_required:fresh')
    expect(kinds).toContain('long_task:long')
    expect(kinds).toContain('stale:stale')
    expect(kinds).toContain('outdated_input:outdated')
    expect(kinds).not.toContain('stale:fresh')
  })
})

describe('userActivityStats', () => {
  it('counts messages/checks/completions/files per user', () => {
    const activity = [act('message.sent'), act('checklist.checked'), act('task.completed'), act('file.uploaded', { userId: 'u2' })]
    const rows = userActivityStats(activity, users, 7, now)
    expect(rows[0]).toMatchObject({ userId: 'u1', messages: 1, checks: 1, completed: 1, total: 3 })
    expect(rows[1]).toMatchObject({ userId: 'u2', files: 1, total: 1 })
  })
})

describe('feedbackDigest', () => {
  it('groups feedback by assistant with avg and comments', () => {
    const tasks = [
      task('t1', { feedback: { rating: 5, comment: 'good', by: 'u1', at: iso(1) } }),
      task('t2', { feedback: { rating: 3, comment: 'meh', by: 'u2', at: iso(2) } }),
    ]
    const rows = feedbackDigest(tasks, assistants, users)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ assistantName: 'A1', count: 2, avgRating: 4 })
    expect(rows[0].comments.map((c) => c.by)).toEqual(['U1', 'U2'])
    expect(feedbackDigestMarkdown(rows)).toContain('A1')
  })
})
