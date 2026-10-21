import { expect, it } from 'vitest'
import type { ActivityLog } from '@mes/domain'
import { describeActivity } from './activity'

it('describes completion with open required checks using the same 필수 wording as the checklist', () => {
  const event = { id: 'e', taskId: 't', userId: 'u', type: 'task.completed', payload: { missingRequired: 2, reason: '일정' }, at: '2026-01-01T00:00:00.000Z' } as ActivityLog
  expect(describeActivity(event)).toBe('필수 체크 2건 미체크 · 사유: 일정')
})
