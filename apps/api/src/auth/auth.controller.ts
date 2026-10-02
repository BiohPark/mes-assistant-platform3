import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, HttpException, Inject, NotFoundException, Post, Req, Res, UnauthorizedException } from '@nestjs/common'
import { CredentialsSchema, type Me } from '@mes/contracts'
import type { CookieOptions, Request, Response } from 'express'
import { CONFIG, type AppConfig } from '../config/config.js'
import type { AuthedRequest } from './guards.js'
import { OIDC, type OidcPort, type PendingLogin } from './oidc.service.js'
import { hashPassword, verifyPassword } from './password.js'
import { Public } from './public.decorator.js'
import { rolesOf } from './roles.js'
import { SESSION_COOKIE, SESSION_STORE, type SessionStore } from './session.service.js'
import { USER_DIRECTORY, type UserDirectory } from './users.service.js'

const PENDING_COOKIE = 'mes_oidc'
const dummyHash = hashPassword('dummy')
const MAX_ATTEMPT_ENTRIES = 10_000

@Controller()
export class AuthController {
  private readonly attempts = new Map<string, { count: number; until: number }>()
  private nextAttemptSweep: number
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OIDC) private readonly oidc: OidcPort,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
  ) { this.nextAttemptSweep = Date.now() + config.authAttempts.windowMs }

  private cookie(extra: CookieOptions = {}): CookieOptions {
    return { httpOnly: true, sameSite: 'lax', secure: this.config.cookieSecure, path: '/', ...extra }
  }

  private ensureLocal() {
    if (this.config.authMode !== 'local') throw new NotFoundException('앱 자체 로그인이 비활성입니다')
  }

  private checkOrigin(req: Request) {
    if ((req.get('Origin') !== undefined && req.get('Origin') !== this.config.appOrigin) || req.get('Sec-Fetch-Site') === 'cross-site') {
      throw new ForbiddenException('허용되지 않은 출처입니다')
    }
  }

  private attempt(req: Request, loginId: string) {
    const now = Date.now()
    if (now >= this.nextAttemptSweep) {
      for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key)
      this.nextAttemptSweep = now + this.config.authAttempts.windowMs
    }
    const ip = req.ip ?? req.socket.remoteAddress ?? ''
    const keys = [`ip:${ip}`, `id:${ip}:${loginId}`]
    const prior = keys.map((key) => {
      const value = this.attempts.get(key)
      if (value && value.until <= now) { this.attempts.delete(key); return undefined }
      return value
    })
    if (prior.some((value) => value && value.count >= this.config.authAttempts.max) ||
      this.attempts.size + prior.filter((value) => !value).length > MAX_ATTEMPT_ENTRIES) {
      throw new HttpException('시도가 너무 많습니다. 잠시 후 다시 시도하세요.', 429)
    }
    return {
      failed: () => {
        const failedAt = Date.now()
        const current = keys.map((key) => {
          const value = this.attempts.get(key)
          if (value && value.until <= failedAt) { this.attempts.delete(key); return undefined }
          return value
        })
        if (this.attempts.size + current.filter((value) => !value).length > MAX_ATTEMPT_ENTRIES) {
          throw new HttpException('시도가 너무 많습니다. 잠시 후 다시 시도하세요.', 429)
        }
        keys.forEach((key, index) => this.attempts.set(key, { count: (current[index]?.count ?? 0) + 1,
          until: current[index]?.until ?? failedAt + this.config.authAttempts.windowMs }))
      },
      succeeded: () => { this.attempts.delete(keys[1]!) },
    }
  }

  private async respondWithSession(user: { id: string; name: string; role: string; isSystemOwner: boolean; isBusinessOwner?: boolean; mustChangePassword?: boolean }, res: Response): Promise<Me> {
    const { token, expiresAt } = await this.sessions.create(user.id)
    res.cookie(SESSION_COOKIE, token, this.cookie({ expires: expiresAt }))
    return { id: user.id, name: user.name, role: user.role, roles: rolesOf(user), ...(user.mustChangePassword && { mustChangePassword: true }) }
  }

  @Get('auth/mode')
  @Public()
  mode() { return { mode: this.config.authMode } }

  @Post('auth/signup')
  @Public()
  async signup(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Me> {
    this.ensureLocal()
    this.checkOrigin(req)
    const parsed = CredentialsSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('ID 또는 비밀번호 형식이 올바르지 않습니다')
    const { loginId, password } = parsed.data
    const attempt = this.attempt(req, loginId)
    if (await this.users.findByLoginId(loginId)) { attempt.failed(); throw new ConflictException('이미 사용 중인 ID입니다') }
    const user = await this.users.createLocal(loginId, await hashPassword(password))
    if (!user) { attempt.failed(); throw new ConflictException('이미 사용 중인 ID입니다') }
    attempt.succeeded()
    return this.respondWithSession(user, res)
  }

  @Post('auth/login')
  @Public()
  @HttpCode(200)
  async localLogin(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Me> {
    this.ensureLocal()
    this.checkOrigin(req)
    const parsed = CredentialsSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('ID 또는 비밀번호 형식이 올바르지 않습니다')
    const { loginId, password } = parsed.data
    const attempt = this.attempt(req, loginId)
    const found = await this.users.findByLoginId(loginId)
    if (!found || !found.active) {
      await verifyPassword(password, await dummyHash)
      attempt.failed()
      throw new UnauthorizedException('ID 또는 비밀번호가 올바르지 않습니다')
    }
    if (!await verifyPassword(password, found.hash)) { attempt.failed(); throw new UnauthorizedException('ID 또는 비밀번호가 올바르지 않습니다') }
    attempt.succeeded()
    return this.respondWithSession(found.user, res)
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
    return { id: user.id, name: user.name, role: user.role, roles: rolesOf(user), ...(user.mustChangePassword && { mustChangePassword: true }) }
  }
}
