import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Role } from '@mes/contracts'
import type { Request } from 'express'
import { IS_PUBLIC } from './public.decorator.js'
import { ROLES } from './roles.decorator.js'
import { rolesOf } from './roles.js'
import { SESSION_COOKIE, SESSION_STORE, type AuthUser, type SessionStore } from './session.service.js'

export type AuthedRequest = Request & { user?: AuthUser }

function allowedBusinessOwnerRoute(method: string, path: string): boolean {
  if (method === 'GET' && (path === '/api/me' || path === '/api/service-requests/intake-assistant')) return true
  if (method === 'POST' && (path === '/api/auth/logout' || path === '/api/auth/password')) return true
  if (method === 'PATCH' && path === '/api/users/me') return true
  if (path === '/api/service-requests') return method === 'GET' || method === 'POST'
  if (/^\/api\/service-requests\/[^/]+$/.test(path)) return method === 'GET' || method === 'DELETE'
  if (/^\/api\/service-requests\/[^/]+\/draft$/.test(path)) return method === 'GET'
  if (/^\/api\/service-requests\/[^/]+\/(?:submit|files)$/.test(path)) return method === 'POST'
  if (/^\/api\/service-requests\/[^/]+\/(?:title|content)$/.test(path)) return method === 'PATCH'
  if (/^\/api\/service-requests\/[^/]+\/results$/.test(path)) return method === 'GET'
  if (/^\/api\/threads\/[^/]+\/messages$/.test(path)) return method === 'GET' || method === 'POST'
  if (/^\/api\/threads\/[^/]+\/requests$/.test(path)) return method === 'POST'
  if (/^\/api\/requests\/[^/]+$/.test(path)) return method === 'GET'
  if (/^\/api\/requests\/[^/]+\/(?:cancel|retry)$/.test(path)) return method === 'POST'
  if (/^\/api\/files\/[^/]+\/content$/.test(path)) return method === 'GET'
  return false
}

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
    if (user.isBusinessOwner && !user.isSystemOwner && !allowedBusinessOwnerRoute(req.method, req.path)) {
      throw new ForbiddenException('SR 접수 권한만 있습니다')
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
