import { SetMetadata } from '@nestjs/common'
import type { Role } from '@mes/contracts'

export const ROLES = 'roles'
/** 이 경로를 쓸 수 있는 역할 (하나라도 있으면 통과). 서버가 강제한다. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles)
