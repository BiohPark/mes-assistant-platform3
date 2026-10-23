import { expect, it } from 'vitest'
import type { ActivityLog } from '@mes/domain'
import { describeActivity } from './activity'

it('describes checklist rename as before → after and removal by its label', () => {
  const base = { id: 'e', taskId: 't', userId: 'u', at: '2026-01-01T00:00:00.000Z' }
  expect(describeActivity({ ...base, type: 'checklist.renamed', payload: { from: '근거 확인', to: '근거 자료 확인' } } as ActivityLog)).toBe('근거 확인 → 근거 자료 확인')
  expect(describeActivity({ ...base, type: 'checklist.removed', payload: { label: '승인 확인' } } as ActivityLog)).toBe('승인 확인')
})

it('describes completion with open required checks using the same 필수 wording as the checklist', () => {
  const event = { id: 'e', taskId: 't', userId: 'u', type: 'task.completed', payload: { missingRequired: 2, reason: '일정' }, at: '2026-01-01T00:00:00.000Z' } as ActivityLog
  expect(describeActivity(event)).toBe('필수 체크 2건 미체크 · 사유: 일정')
})
