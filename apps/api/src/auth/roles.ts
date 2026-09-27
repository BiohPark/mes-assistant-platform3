import type { Role } from '@mes/contracts'

/** 앱이 관리하는 역할 (D21). 요청자 역할 저장 방식은 S4에서 정한다. */
export function rolesOf(user: { isSystemOwner: boolean }): Role[] {
  return user.isSystemOwner ? ['member', 'system_owner'] : ['member']
}
