import type { Role } from '@mes/contracts'

/** 앱이 관리하는 역할 (D21, D33). */
export function rolesOf(user: { isSystemOwner: boolean; isBusinessOwner?: boolean }): Role[] {
  const roles: Role[] = ['member']
  if (user.isSystemOwner) roles.push('system_owner')
  if (user.isBusinessOwner) roles.push('requester')
  return roles
}
