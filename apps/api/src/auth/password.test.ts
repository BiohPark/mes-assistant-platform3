import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password.js'

describe('local 비밀번호', () => {
  it('scrypt 형식으로 저장하고 올바른 비밀번호만 검증한다', async () => {
    const hash = await hashPassword('password-1234')
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/)
    expect(await verifyPassword('password-1234', hash)).toBe(true)
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
    expect(await verifyPassword('password-1234', 'malformed')).toBe(false)
    expect(await verifyPassword('password-1234', `${hash}!`)).toBe(false)
  })
})
