import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Role } from '@mes/contracts'
import type { Request } from 'express'
import { IS_PUBLIC } from './public.decorator.js'
import { ROLES } from './roles.decorator.js'
import { rolesOf } from './roles.js'
import { SESSION_COOKIE, SESSION_STORE, type AuthUser, type SessionStore } from './session.service.js'

export type AuthedRequest = Request & { user?: AuthUser }

/** 모든 경로는 기본으로 로그인 필요. @Public()만 예외. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true
    const req = ctx.switchToHttp().getRequest<AuthedRequest>()
    const token: unknown = req.cookies?.[SESSION_COOKIE]
    const user = typeof token === 'string' && token ? await this.sessions.resolve(token) : null
    if (!user) throw new UnauthorizedException('로그인이 필요합니다')
    req.user = user
    if (user.mustChangePassword && !['/api/me', '/api/auth/password', '/api/auth/logout'].includes(req.path)) {
      throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: '비밀번호 변경이 필요합니다' })
    }
    return true
  }
}

/** @Roles(...)가 붙은 경로는 그 역할 중 하나가 있어야 한다 (서버 강제) */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()])
    if (!required?.length) return true
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user
    if (user && rolesOf(user).some((r) => required.includes(r))) return true
    throw new ForbiddenException('권한이 없습니다')
  }
}
