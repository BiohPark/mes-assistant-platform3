import { describe, expect, it } from 'vitest'
import { MeSchema, RoleSchema } from './auth.js'

describe('auth contracts', () => {
  it('openapi User 스키마와 같은 모양의 /me 응답을 받아들인다', () => {
    const me = MeSchema.parse({ id: 'u1', name: '김운영', role: '', roles: ['member', 'system_owner'] })
    expect(me.roles).toEqual(['member', 'system_owner'])
  })

  it('정의되지 않은 역할은 거부한다', () => {
    expect(RoleSchema.safeParse('admin').success).toBe(false)
  })
})
