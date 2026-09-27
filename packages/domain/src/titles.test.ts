import { describe, it, expect } from 'vitest'
import { cleanTitle, ruleTitle } from './titles.js'

describe('ruleTitle', () => {
  it('skips trivial openers and uses the first sentence of the next message', () => {
    expect(ruleTitle(['시작', '알람 목록에 장비별 필터가 필요해요. 하루 수백 건이라'])).toBe('알람 목록에 장비별 필터가 필요해요')
  })
  it('returns undefined when there is nothing meaningful', () => {
    expect(ruleTitle(['시작', '  '])).toBeUndefined()
  })
  it('truncates long text', () => {
    expect(ruleTitle(['가'.repeat(50)])!.endsWith('…')).toBe(true)
  })
})

describe('cleanTitle', () => {
  it('strips quotes, prefixes and markdown', () => {
    expect(cleanTitle('제목: "**알람 필터 FDS**"\n부연')).toBe('알람 필터 FDS')
    expect(cleanTitle('# 3라인 장비 등록')).toBe('3라인 장비 등록')
  })
})
