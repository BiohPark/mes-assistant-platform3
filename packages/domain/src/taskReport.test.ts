import { describe, it, expect } from 'vitest'
import { buildTaskReport } from './taskReport.js'

describe('buildTaskReport', () => {
  it('renders header, checklist, outputs, tags, inputs and feedback', () => {
    const md = buildTaskReport({
      task: {
        code: 'WK-2026-0001',
        title: 'T',
        summary: 'S',
        status: 'done',
        checklist: [{ id: 'c', label: 'A', required: true, checked: true }],
        outputFileIds: ['f1'],
        tags: ['SR-2026-0002'],
        checklistReview: { at: '2026-09-05T00:00:00.000Z', by: 'u1', met: 1, total: 1, items: [], source: 'ai' },
        createdAt: '2026-09-01T00:00:00.000Z',
        startedAt: '2026-09-01T00:00:00.000Z',
        completedAt: '2026-09-05T00:00:00.000Z',
        feedback: { rating: 5, comment: 'good', by: 'u1', at: '' },
      } as never,
      assistant: { name: 'URS 작성 도우미', level1: 'ET 개발', level2: 'URS 작성' } as never,
      files: [{ id: 'f1', name: 'URS.md' } as never],
      inputs: [{ name: 'FDS.md', version: 2, weight: 'main', fromAssistantName: 'FDS 작성 도우미' }],
      users: new Map([['u1', { name: '한지수' }]]),
      now: new Date('2026-09-05T00:00:00.000Z'),
    })
    expect(md).toContain('# 업무 완료 리포트 — WK-2026-0001 T')
    expect(md).toContain('URS 작성 도우미')
    expect(md).toContain('- [x] A (중요)')
    expect(md).toContain('- AI 달성도: 1/1')
    expect(md).toContain('URS.md')
    expect(md).toContain('태그: SR-2026-0002')
    expect(md).toContain('[주 입력] FDS.md v2 ← FDS 작성 도우미')
    expect(md).toContain('★ 5')
    expect(md).toContain('한지수')
    expect(md).toContain('리드타임: 4일')
  })
  it('handles empty sections', () => {
    const md = buildTaskReport({
      task: { code: 'WK-1', title: 'T', summary: '', status: 'done', checklist: [], outputFileIds: [], tags: [], createdAt: '2026-09-01T00:00:00.000Z' } as never,
      assistant: { name: 'A', level1: 'L1', level2: 'L2' } as never,
      files: [],
      inputs: [],
      users: new Map(),
    })
    expect(md).toContain('(없음)')
  })

  it('records the completion reason under the checklist only when given', () => {
    const base = { task: { code: 'WK-2026-0002', title: 'T', summary: '', status: 'done', checklist: [{ id: 'c', label: 'A', required: true, checked: false }], outputFileIds: [], tags: [],
      createdAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-05T00:00:00.000Z' } as never,
      assistant: { name: 'A', level1: 'L1', level2: 'L2' } as never, files: [], inputs: [], users: new Map(), now: new Date('2026-09-05T00:00:00.000Z') }
    expect(buildTaskReport(base)).not.toContain('완료 사유')
    expect(buildTaskReport({ ...base, completionReason: '담당자 구두 승인' })).toContain('- 필수 항목 미완료 완료 사유: 담당자 구두 승인')
  })
})


it('renders every path in the same order as the transmitted context', () => {
  const md = buildTaskReport({ task: { code: 'WK-1', title: 'T', summary: '', status: 'done', checklist: [], outputFileIds: [], tags: [], createdAt: '2026-09-01' } as never,
    assistant: { name: 'A', level1: 'SDLC', level2: '분석', classifications: [
      { level1: 'SDLC', level2: '분석', level1CodeId: 'l1', level2CodeId: 'l2' },
      { level1: 'Record', level2: 'CCA', level1CodeId: 'r1', level2CodeId: 'r2' },
    ] } as never, files: [], inputs: [], users: new Map() })
  expect(md).toContain('A (SDLC > 분석, Record > CCA)')
})
