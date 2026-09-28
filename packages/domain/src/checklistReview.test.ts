import { describe, it, expect } from 'vitest'
import { checklistReviewPrompt, parseChecklistReview, ruleChecklistReview } from './checklistReview.js'
import type { ChecklistItem } from './types.js'

const items: ChecklistItem[] = [
  { id: 'a', label: '요구사항 ID 부여', required: true, checked: false },
  { id: 'b', label: 'GxP 영향 표시', required: false, checked: true },
  { id: 'c', label: '요청자 확인', required: false, checked: false },
]
const meta = { by: 'u1', at: '2026-09-23T00:00:00.000Z' }

describe('checklistReviewPrompt', () => {
  it('numbers the items and asks for JSON only', () => {
    const p = checklistReviewPrompt(items)
    expect(p).toContain('1. 요구사항 ID 부여')
    expect(p).toContain('3. 요청자 확인')
    expect(p).toMatch(/JSON/)
  })
})

describe('parseChecklistReview', () => {
  it('reads a fenced JSON object keyed by item number', () => {
    const raw = '결과입니다\n```json\n{"items":[{"no":1,"met":true,"note":"URS-01~03 부여"},{"no":2,"met":false,"note":"언급 없음"},{"no":3,"met":false}]}\n```'
    const r = parseChecklistReview(raw, items, meta)!
    expect(r).toMatchObject({ met: 1, total: 3, source: 'ai' })
    expect(r.items.map((i) => [i.itemId, i.met])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
    ])
    expect(r.items[0].note).toBe('URS-01~03 부여')
  })
  it('accepts a bare array and fills missing items as not met', () => {
    const r = parseChecklistReview('[{"no":3,"met":true,"note":"확인 받음"}]', items, meta)!
    expect(r.met).toBe(1)
    expect(r.items.find((i) => i.itemId === 'a')).toMatchObject({ met: false })
  })
  it('returns undefined for non-JSON answers', () => {
    expect(parseChecklistReview('잘 모르겠습니다', items, meta)).toBeUndefined()
  })
})

describe('ruleChecklistReview', () => {
  it('counts user-checked items and items whose words appear in assistant replies', () => {
    const r = ruleChecklistReview(items, ['URS 초안입니다. 요구사항 ID를 부여했습니다.'], meta)
    expect(r.source).toBe('rule')
    expect(r.items.map((i) => i.met)).toEqual([true, true, false])
    expect(r.met).toBe(2)
  })
})
