import { describe, expect, it } from 'vitest'
import { AuthModeSchema, CredentialsSchema, LoginIdSchema, MeSchema, PasswordSchema, RoleSchema } from './auth.js'

describe('auth contracts', () => {
  it('openapi User 스키마와 같은 모양의 /me 응답을 받아들인다', () => {
    const me = MeSchema.parse({ id: 'u1', name: '김운영', role: '', roles: ['member', 'system_owner'] })
    expect(me.roles).toEqual(['member', 'system_owner'])
  })

  it('정의되지 않은 역할은 거부한다', () => {
    expect(RoleSchema.safeParse('admin').success).toBe(false)
  })

  it('인증 모드와 ID·비밀번호 경계를 검증한다', () => {
    expect(AuthModeSchema.parse('local')).toBe('local')
    expect(AuthModeSchema.parse('oidc')).toBe('oidc')
    expect(AuthModeSchema.safeParse('other').success).toBe(false)
    for (const id of ['abc', 'a'.repeat(32), 'a.1_-']) expect(LoginIdSchema.safeParse(id).success).toBe(true)
    for (const id of ['ab', 'a'.repeat(33), 'UPPER', '한글', 'has space']) expect(LoginIdSchema.safeParse(id).success).toBe(false)
    expect(PasswordSchema.safeParse('12345678').success).toBe(true)
    expect(PasswordSchema.safeParse('x'.repeat(128)).success).toBe(true)
    expect(PasswordSchema.safeParse('1234567').success).toBe(false)
    expect(PasswordSchema.safeParse('x'.repeat(129)).success).toBe(false)
    expect(CredentialsSchema.safeParse({ loginId: 'abc', password: '12345678' }).success).toBe(true)
  })
})
