import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Post, Req, Res, UnauthorizedException } from '@nestjs/common'
import { CredentialsSchema, type Me } from '@mes/contracts'
import type { CookieOptions, Response } from 'express'
import { CONFIG, type AppConfig } from '../config/config.js'
import type { AuthedRequest } from './guards.js'
import { OIDC, type OidcPort, type PendingLogin } from './oidc.service.js'
import { hashPassword, verifyPassword } from './password.js'
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

  private ensureLocal() {
    if (this.config.authMode !== 'local') throw new NotFoundException('앱 자체 로그인이 비활성입니다')
  }

  private async respondWithSession(user: { id: string; name: string; role: string; isSystemOwner: boolean }, res: Response): Promise<Me> {
    const { token, expiresAt } = await this.sessions.create(user.id)
    res.cookie(SESSION_COOKIE, token, this.cookie({ expires: expiresAt }))
    return { id: user.id, name: user.name, role: user.role, roles: rolesOf(user) }
  }

  @Get('auth/mode')
  @Public()
  mode() { return { mode: this.config.authMode } }

  @Post('auth/signup')
  @Public()
  async signup(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<Me> {
    this.ensureLocal()
    const parsed = CredentialsSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('ID 또는 비밀번호 형식이 올바르지 않습니다')
    const { loginId, password } = parsed.data
    const user = await this.users.createLocal(loginId, await hashPassword(password))
    if (!user) throw new ConflictException('이미 사용 중인 ID입니다')
    return this.respondWithSession(user, res)
  }

  @Post('auth/login')
  @Public()
  @HttpCode(200)
  async localLogin(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<Me> {
    this.ensureLocal()
    const parsed = CredentialsSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('ID 또는 비밀번호 형식이 올바르지 않습니다')
    const { loginId, password } = parsed.data
    const found = await this.users.findByLoginId(loginId)
    if (!found || !found.active || !await verifyPassword(password, found.hash)) throw new UnauthorizedException('ID 또는 비밀번호가 올바르지 않습니다')
    const user = this.config.initialSystemOwners.includes(loginId) && !found.user.isSystemOwner
      ? await this.users.grantSystemOwner(loginId) : found.user
    return this.respondWithSession(user, res)
  }

  @Get('auth/login')
  @Public()
  async login(@Res() res: Response) {
    if (this.config.authMode !== 'oidc') throw new NotFoundException('SSO 로그인이 비활성입니다')
    const { url, pending } = await this.oidc.start()
    res.cookie(PENDING_COOKIE, JSON.stringify(pending), this.cookie({ signed: true, maxAge: 10 * 60_000 }))
    res.redirect(302, url)
  }

  @Get('auth/callback')
  @Public()
  async callback(@Req() req: AuthedRequest, @Res() res: Response) {
    if (this.config.authMode !== 'oidc') throw new NotFoundException('SSO 로그인이 비활성입니다')
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
