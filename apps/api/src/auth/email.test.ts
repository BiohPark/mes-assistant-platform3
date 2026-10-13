import { describe, expect, it } from 'vitest'
import { emailView } from './email.js'

describe('이메일 응답 기본값', () => {
  it('저장값은 대소문자까지 그대로 쓰며 설정과 무관하다', () => {
    expect(emailView({ email: 'Mixed.Case@example.net', loginId: 'abc' }, 'example.com')).toEqual({ email: 'Mixed.Case@example.net', emailIsDefault: false })
    expect(emailView({ email: 'abc@example.com', loginId: 'abc' }, 'example.com').emailIsDefault).toBe(false)
  })
  it('null일 때 로그인 ID와 설정 도메인이 모두 있어야 기본값이다', () => {
    expect(emailView({ email: null, loginId: 'abc' }, 'example.com')).toEqual({ email: 'abc@example.com', emailIsDefault: true })
    for (const [loginId, domain] of [['abc', undefined], [null, 'example.com'], [null, undefined]] as const) {
      expect(emailView({ email: null, loginId }, domain)).toEqual({ email: null, emailIsDefault: false })
    }
  })
})
