import { describe, it, expect } from 'vitest'
import { draftFromConversation } from './srDraft.js'

const m = (role: 'user' | 'assistant', content: string) => ({ role, content })

describe('draftFromConversation', () => {
  it('uses first user line as title and joins user turns as body', () => {
    const d = draftFromConversation([
      m('user', '알람 화면에 장비별 필터가 필요해요'),
      m('assistant', '배경?'),
      m('user', '알람이 너무 많아 찾기 어려움'),
      m('assistant', '기한?'),
      m('user', '10월 초'),
    ])
    expect(d.title).toBe('알람 화면에 장비별 필터가 필요해요')
    expect(d.body).toContain('## 요청 내용')
    expect(d.body).toContain('- 알람이 너무 많아 찾기 어려움')
    expect(d.body).toContain('- 10월 초')
  })
  it('truncates long titles to 60 chars', () => {
    const d = draftFromConversation([m('user', 'x'.repeat(100))])
    expect(d.title.length).toBe(60)
  })
  it('empty conversation gives empty draft', () => {
    expect(draftFromConversation([])).toEqual({ title: '', body: '' })
  })
})
