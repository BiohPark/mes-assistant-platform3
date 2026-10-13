import { describe, expect, it } from 'vitest'
import { AuthModeSchema, CredentialsSchema, LoginIdSchema, MeSchema, PasswordSchema, ProfilePatchSchema, RoleSchema } from './auth.js'

describe('auth contracts', () => {
  it.each(['example-.com', '-example.com', `${'a'.repeat(64)}.com`, 'example..com', 'exam_ple.com'])('이메일 도메인 %s의 잘못된 구간을 거부한다', (domain) => {
    expect(ProfilePatchSchema.safeParse({ email: `u@${domain}` }).success).toBe(false)
  })
  it.each(['a.co', 'EXAMPLE.COM', 'my-company.example.com', `${'a'.repeat(63)}.com`])('이메일 도메인 %s의 유효한 구간을 허용한다', (domain) => {
    expect(ProfilePatchSchema.parse({ email: `u@${domain}` })).toEqual({ email: `u@${domain}` })
  })
  it('이메일은 빈 값·null을 해제하고 형식과 191자 경계를 검증한다', () => {
    const boundary = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(58)}.com`
    expect(boundary).toHaveLength(191)
    for (const email of ['Mixed.Case@example.com', boundary]) expect(ProfilePatchSchema.parse({ email })).toEqual({ email })
    for (const email of ['', null]) expect(ProfilePatchSchema.parse({ email })).toEqual({ email: null })
    for (const email of ['wrong', 'a@', ' a@example.com ', boundary.replace('.com', 'c.com'), 1]) expect(ProfilePatchSchema.safeParse({ email }).success).toBe(false)
    expect(ProfilePatchSchema.safeParse({ email: undefined }).success).toBe(false)
    expect(ProfilePatchSchema.safeParse({ email: 'a@example.com', id: 'other' }).success).toBe(false)
  })
  it('/me 이메일과 기본값 여부는 필수이며 null도 허용한다', () => {
    const user = { id: 'u1', name: '김운영', role: '', roles: ['member'], theme: 'system', locale: 'ko' }
    expect(MeSchema.safeParse(user).success).toBe(false)
    expect(MeSchema.parse({ ...user, email: null, emailIsDefault: false })).toMatchObject({ email: null, emailIsDefault: false })
    expect(MeSchema.parse({ ...user, email: 'u1@example.com', emailIsDefault: true })).toMatchObject({ email: 'u1@example.com', emailIsDefault: true })
  })
  it('openapi User 스키마와 같은 모양의 /me 응답을 받아들인다', () => {
    const me = MeSchema.parse({ id: 'u1', name: '김운영', role: '', roles: ['member', 'system_owner'], theme: 'system', locale: 'ko', email: null, emailIsDefault: false })
    expect(me.roles).toEqual(['member', 'system_owner'])
  })

  it('프로필 테마·언어는 허용 값만 받고 필수다', () => {
    const user = { id: 'u1', name: '김운영', role: '', roles: ['member'], theme: 'dark', locale: 'en', email: null, emailIsDefault: false }
    expect(MeSchema.parse(user)).toMatchObject({ theme: 'dark', locale: 'en', email: null, emailIsDefault: false })
    for (const patch of [{ theme: 'other' }, { locale: 'ja' }, { theme: undefined }, { locale: undefined }]) {
      expect(MeSchema.safeParse({ ...user, ...patch }).success).toBe(false)
    }
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
