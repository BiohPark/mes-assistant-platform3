import { describe, expect, it, vi } from 'vitest'
import { patchTaskPhase } from './tasks.cache'

describe('patchTaskPhase', () => {
  it('shows a request that just started on a cached card before the throttled list GET (no chip yet or a finished one)', () => {
    vi.useFakeTimers({ now: new Date('2026-10-19T12:00:00.000Z') })
    try {
      const idle = { id: 't', aiRequest: null }
      const failed = { id: 'f', aiRequest: { status: 'failed' as const, updatedAt: '2026-10-18T00:00:00.000Z' } }
      const other = { id: 'o', aiRequest: null }
      expect(patchTaskPhase([idle, failed, other] as never, 't', 'pending', '파일 처리 대기')).toEqual([
        { id: 't', aiRequest: { status: 'pending', phase: '파일 처리 대기', updatedAt: '2026-10-19T12:00:00.000Z' } }, failed, other,
      ])
      expect(patchTaskPhase([failed] as never, 'f', 'streaming')).toEqual([{ id: 'f', aiRequest: { status: 'streaming', phase: undefined, updatedAt: '2026-10-19T12:00:00.000Z' } }])
    } finally { vi.useRealTimers() }
  })
  it('moves pending to streaming keeping the start time, and only patches the phase when the status is unchanged', () => {
    const pending = { id: 't', aiRequest: { status: 'pending' as const, phase: '파일 처리 대기', updatedAt: 'start' } }
    expect(patchTaskPhase([pending] as never, 't', 'streaming')).toEqual([{ id: 't', aiRequest: { status: 'streaming', phase: undefined, updatedAt: 'start' } }])
    expect(patchTaskPhase([pending] as never, 't', 'pending', '파일 올리는 중')).toEqual([{ id: 't', aiRequest: { ...pending.aiRequest, phase: '파일 올리는 중' } }])
  })
})
