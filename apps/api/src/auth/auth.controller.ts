import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, HttpException, Inject, NotFoundException, Post, Req, Res, UnauthorizedException } from '@nestjs/common'
import { CredentialsSchema, SignupSchema, type Me } from '@mes/contracts'
import type { CookieOptions, Request, Response } from 'express'
import { CONFIG, type AppConfig } from '../config/config.js'
import type { AuthedRequest } from './guards.js'
import { OIDC, type OidcPort, type PendingLogin } from './oidc.service.js'
import { hashPassword, verifyPassword } from './password.js'
import { Public } from './public.decorator.js'
import { rolesOf } from './roles.js'
import { SESSION_COOKIE, SESSION_STORE, type SessionStore, type AuthUser } from './session.service.js'
import { USER_DIRECTORY, type UserDirectory } from './users.service.js'

const PENDING_COOKIE = 'mes_oidc'
const dummyHash = hashPassword('dummy')
const MAX_ATTEMPT_ENTRIES = 10_000
type AttemptEntry = { count: number; pending: number; until: number; waiters: Set<() => void> }

@Controller()
export class AuthController {
  private readonly attempts = new Map<string, AttemptEntry>()
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

  private async attempt(req: Request, loginId: string) {
    const now = Date.now()
    if (now >= this.nextAttemptSweep) {
      for (const [key, value] of this.attempts) if (value.until <= now && !value.pending) this.attempts.delete(key)
      this.nextAttemptSweep = now + this.config.authAttempts.windowMs
    }
    const ip = req.ip ?? req.socket.remoteAddress ?? ''
    const keys = [`ip:${ip}`, `id:${ip}:${loginId}`]
    const current = (key: string) => {
      const checkedAt = Date.now()
      const value = this.attempts.get(key)
      if (value && value.until <= checkedAt) {
        if (!value.pending) { this.attempts.delete(key); return undefined }
        value.count = 0
        value.until = checkedAt + this.config.authAttempts.windowMs
      }
      return value
    }
    const tooMany = () => new HttpException('시도가 너무 많습니다. 잠시 후 다시 시도하세요.', 429)
    const reserve = (key: string, value: AttemptEntry | undefined) => {
      if (!value) {
        if (this.attempts.size >= MAX_ATTEMPT_ENTRIES) {
          const checkedAt = Date.now()
          for (const [oldest, evicted] of this.attempts.entries()) {
            if (evicted.pending || (evicted.until > checkedAt && evicted.count >= this.config.authAttempts.max)) continue
            this.attempts.delete(oldest)
            for (const wake of evicted.waiters) wake()
            evicted.waiters.clear()
            break
          }
          if (this.attempts.size >= MAX_ATTEMPT_ENTRIES) throw tooMany()
        }
        value = { count: 0, pending: 0, until: Date.now() + this.config.authAttempts.windowMs, waiters: new Set() }
        this.attempts.set(key, value)
      }
      value.pending++
      return value
    }
    const ipPrior = current(keys[0]!)
    if ((ipPrior?.count ?? 0) >= this.config.authAttempts.max || (ipPrior?.pending ?? 0) >= this.config.authAttempts.ipPendingMax) throw tooMany()
    const ipEntry = reserve(keys[0]!, ipPrior)
    let idEntry: AttemptEntry
    try {
      while (true) {
        const prior = current(keys[1]!)
        if ((current(keys[0]!)?.count ?? 0) >= this.config.authAttempts.max || (prior?.count ?? 0) >= this.config.authAttempts.max) throw tooMany()
        if ((prior?.count ?? 0) + (prior?.pending ?? 0) < this.config.authAttempts.max) {
          idEntry = reserve(keys[1]!, prior)
          break
        }
        await new Promise<void>((resolve) => { prior!.waiters.add(resolve) })
      }
    } catch (error) { ipEntry.pending--; throw error }
    let released = false
    const release = () => {
      if (released) return
      released = true
      ipEntry.pending--
      idEntry.pending--
      for (const wake of idEntry.waiters) wake()
      idEntry.waiters.clear()
    }
    return {
      failed: () => {
        release()
        const failedAt = Date.now()
        const priorIp = current(keys[0]!)
        const priorId = current(keys[1]!)
        if ((priorIp?.count ?? 0) >= this.config.authAttempts.max || (priorId?.count ?? 0) >= this.config.authAttempts.max) throw tooMany()
        keys.forEach((key) => {
          let value = this.attempts.get(key)
          if (value && value.until <= failedAt) {
            value.count = 0
            value.until = failedAt + this.config.authAttempts.windowMs
          }
          if (!value) {
            value = reserve(key, undefined)
            value.pending--
            value.until = failedAt + this.config.authAttempts.windowMs
          }
          value.count++
        })
      },
      succeeded: () => {
        release()
        const idAttempt = this.attempts.get(keys[1]!)
        if (idAttempt === idEntry) {
          idAttempt.count = 0
          if (!idAttempt.pending) this.attempts.delete(keys[1]!)
        }
      },
      release,
    }
  }

  private async respondWithSession(user: AuthUser, res: Response): Promise<Me> {
    const { token, expiresAt } = await this.sessions.create(user.id)
    res.cookie(SESSION_COOKIE, token, this.cookie({ expires: expiresAt }))
    return { id: user.id, name: user.name, role: user.role, theme: user.theme, locale: user.locale, roles: rolesOf(user), ...(user.mustChangePassword && { mustChangePassword: true }) }
  }

  @Get('auth/mode')
  @Public()
  mode() { return { mode: this.config.authMode } }

  @Post('auth/signup')
  @Public()
  async signup(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Me> {
    this.ensureLocal()
    this.checkOrigin(req)
    const parsed = SignupSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('ID 또는 비밀번호 형식이 올바르지 않습니다')
    const { loginId, password, name } = parsed.data
    const attempt = await this.attempt(req, loginId)
    try {
      if (await this.users.findByLoginId(loginId)) { attempt.failed(); throw new ConflictException('이미 사용 중인 ID입니다') }
      const user = await this.users.createLocal(loginId, await hashPassword(password), name)
      if (!user) { attempt.failed(); throw new ConflictException('이미 사용 중인 ID입니다') }
      attempt.succeeded()
      return this.respondWithSession(user, res)
    } finally { attempt.release() }
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
    const attempt = await this.attempt(req, loginId)
    try {
      const found = await this.users.findByLoginId(loginId)
      if (!found || !found.active) {
        await verifyPassword(password, await dummyHash)
        attempt.failed()
        throw new UnauthorizedException('ID 또는 비밀번호가 올바르지 않습니다')
      }
      if (!await verifyPassword(password, found.hash)) { attempt.failed(); throw new UnauthorizedException('ID 또는 비밀번호가 올바르지 않습니다') }
      attempt.succeeded()
      return this.respondWithSession(found.user, res)
    } finally { attempt.release() }
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
    return { id: user.id, name: user.name, role: user.role, theme: user.theme, locale: user.locale, roles: rolesOf(user), ...(user.mustChangePassword && { mustChangePassword: true }) }
  }
}
