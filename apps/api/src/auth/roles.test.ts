import { describe, expect, it } from 'vitest'
import { rolesOf } from './roles.js'

describe('rolesOf', () => {
  it('모든 사용자는 담당자(member), SO 표시가 있으면 system_owner 추가', () => {
    expect(rolesOf({ isSystemOwner: false })).toEqual(['member'])
    expect(rolesOf({ isSystemOwner: true })).toEqual(['member', 'system_owner'])
  })
})
