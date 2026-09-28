import { BadRequestException, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common'
import type { Me } from '@mes/contracts'
import type { CookieOptions, Response } from 'express'
import { CONFIG, type AppConfig } from '../config/config.js'
import type { AuthedRequest } from './guards.js'
import { OIDC, type OidcPort, type PendingLogin } from './oidc.service.js'
import { Public } from './public.decorator.js'
import { rolesOf } from './roles.js'
import { SESSION_COOKIE, SESSION_STORE, type SessionStore } from './session.service.js'
import { USER_DIRECTORY, type UserDirectory } from './users.service.js'

const PENDING_COOKIE = 'mes_oidc'

@Controller()
export class AuthController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OIDC) private readonly oidc: OidcPort,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
  ) {}

  private cookie(extra: CookieOptions = {}): CookieOptions {
    return { httpOnly: true, sameSite: 'lax', secure: this.config.cookieSecure, path: '/', ...extra }
  }

  @Get('auth/login')
  @Public()
  async login(@Res() res: Response) {
    const { url, pending } = await this.oidc.start()
    res.cookie(PENDING_COOKIE, JSON.stringify(pending), this.cookie({ signed: true, maxAge: 10 * 60_000 }))
    res.redirect(302, url)
  }

  @Get('auth/callback')
  @Public()
  async callback(@Req() req: AuthedRequest, @Res() res: Response) {
    const raw: unknown = req.signedCookies?.[PENDING_COOKIE]
    if (typeof raw !== 'string') throw new BadRequestException('로그인 시작 기록이 없거나 만료되었습니다. 다시 로그인하세요.')
    const pending = JSON.parse(raw) as PendingLogin
    // IdP가 본 주소는 앱 주소 기준 (개발에서는 Vite 프록시 뒤)
    const claims = await this.oidc.finish(new URL(req.originalUrl, this.config.appOrigin), pending)
    const user = await this.users.upsertFromClaims(claims)
    const { token, expiresAt } = await this.sessions.create(user.id)
    res.clearCookie(PENDING_COOKIE, this.cookie())
    res.cookie(SESSION_COOKIE, token, this.cookie({ expires: expiresAt }))
    res.redirect(302, `${this.config.appOrigin}/`)
  }

  @Post('auth/logout')
  @Public()
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const token: unknown = req.cookies?.[SESSION_COOKIE]
    if (typeof token === 'string' && token) await this.sessions.destroy(token)
    res.clearCookie(SESSION_COOKIE, this.cookie())
  }

  @Get('me')
  me(@Req() req: AuthedRequest): Me {
    const user = req.user!
    return { id: user.id, name: user.name, role: user.role, roles: rolesOf(user) }
  }
}
