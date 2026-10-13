import { describe, expect, it } from 'vitest'
import { isSrClosed, SR_MANUAL_STATUSES, SR_STAGE_FLOW, SR_STAGES, srReasonRequired, srStage } from './srStage.js'
import { SR_STATUSES } from './types.js'

describe('srStage', () => {
  it('maps every DB status to a display stage; reviewing folds into submitted', () => {
    expect(srStage('reviewing')).toBe('submitted')
    for (const status of SR_STATUSES) {
      if (status === 'reviewing') continue
      expect(srStage(status)).toBe(status)
    }
    expect(SR_STATUSES.map(srStage).every((stage) => stage === 'draft' || SR_STAGES.includes(stage))).toBe(true)
  })

  it('exposes a 4-step flow plus rejected, in order', () => {
    expect(SR_STAGE_FLOW).toEqual(['submitted', 'in_progress', 'responded', 'done'])
    expect(SR_STAGES).toEqual([...SR_STAGE_FLOW, 'rejected'])
  })

  it('allows only done, rejected and reopen (in_progress) as manual statuses', () => {
    expect([...SR_MANUAL_STATUSES]).toEqual(['in_progress', 'done', 'rejected'])
    expect(SR_MANUAL_STATUSES).not.toContain('reviewing')
  })

  it('requires a reason for done and rejected only', () => {
    expect(srReasonRequired('done')).toBe(true)
    expect(srReasonRequired('rejected')).toBe(true)
    expect(srReasonRequired('in_progress')).toBe(false)
  })

  it('treats done and rejected as closed (reopenable)', () => {
    expect(isSrClosed('done')).toBe(true)
    expect(isSrClosed('rejected')).toBe(true)
    for (const status of ['draft', 'submitted', 'reviewing', 'in_progress', 'responded'] as const) expect(isSrClosed(status)).toBe(false)
  })
})
