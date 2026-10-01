import { randomUUID } from 'node:crypto'
import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { eq, sql } from 'drizzle-orm'
import { CONFIG, type AppConfig } from '../config/config.js'
import { DB, type Db } from '../db/db.module.js'
import { appUser } from '../db/schema.js'
import { isDuplicateKey } from '../db/errors.js'
import { initialsOf, pickColor } from './userDisplay.js'
import type { AuthUser } from './session.service.js'

/** IdP가 준 사용자 정보 중 쓰는 것 (OIDC 표준 클레임) */
export interface SsoClaims {
  sub: string
  preferred_username?: string
  name?: string
}

export interface UserDirectory {
  upsertFromClaims(claims: SsoClaims): Promise<AuthUser>
  createLocal(loginId: string, hash: string): Promise<AuthUser | null>
  findByLoginId(loginId: string): Promise<{ user: AuthUser; hash: string; active: boolean } | null>
}

export const USER_DIRECTORY = Symbol('USER_DIRECTORY')

/** sub는 발급자(IdP) 안에서만 유일하다 — 저장 키는 `{issuer}#{sub}` (IdP를 바꿔도 남의 계정·권한을 이어받지 않게) */
export const ssoSubjectKey = (issuer: string, sub: string) => `${issuer}#${sub}`

@Injectable()
export class DbUserDirectory implements UserDirectory {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async createLocal(loginId: string, hash: string): Promise<AuthUser | null> {
    const id = randomUUID()
    return this.db.transaction(async (tx) => {
      const candidate = this.config.initialSystemOwners.includes(loginId)
      if (candidate) await tx.execute(sql`insert into db_lock (lock_key) values ('system-owner') on duplicate key update lock_key = lock_key`)
      const [owner] = candidate ? await tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.isSystemOwner, true)).limit(1) : []
      try {
        await tx.insert(appUser).values({
          id, loginId, passwordHash: hash, name: loginId, initials: initialsOf(loginId), color: pickColor(id),
          isSystemOwner: candidate && !owner,
        })
      } catch (error) {
        if (isDuplicateKey(error)) return null
        throw error
      }
      const [row] = await tx.select({ id: appUser.id, name: appUser.name, role: appUser.role, isSystemOwner: appUser.isSystemOwner, isBusinessOwner: appUser.isBusinessOwner }).from(appUser).where(eq(appUser.id, id))
      return row ?? null
    })
  }

  async findByLoginId(loginId: string) {
    const [row] = await this.db.select({
      id: appUser.id, name: appUser.name, role: appUser.role, isSystemOwner: appUser.isSystemOwner, isBusinessOwner: appUser.isBusinessOwner,
      hash: appUser.passwordHash, active: appUser.active, mustChangePassword: appUser.mustChangePassword,
    }).from(appUser).where(eq(appUser.loginId, loginId))
    if (!row?.hash) return null
    const { hash, active, ...user } = row
    return { user, hash, active }
  }

  /** 첫 로그인 때 app_user를 만들고, 이후에는 이름만 IdP 값으로 맞춘다. 역할은 앱이 관리한다(D21). */
  async upsertFromClaims(claims: SsoClaims): Promise<AuthUser> {
    const subject = ssoSubjectKey(this.config.oidc!.issuer, claims.sub)
    if (subject.length > 512) throw new BadRequestException('SSO 식별자는 512자를 넘을 수 없습니다')
    const name = claims.name?.trim() || claims.preferred_username || claims.sub
    const owners = this.config.initialSystemOwners
    const initialOwner = owners.includes(claims.sub) || (!!claims.preferred_username && owners.includes(claims.preferred_username))
    const id = randomUUID()
    return this.db.transaction(async (tx) => {
      if (initialOwner) await tx.execute(sql`insert into db_lock (lock_key) values ('system-owner') on duplicate key update lock_key = lock_key`)
      const [owner] = initialOwner ? await tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.isSystemOwner, true)).limit(1) : []
      try {
        await tx.insert(appUser).values({ id, ssoSubject: subject, name, initials: initialsOf(name), color: pickColor(id), isSystemOwner: initialOwner && !owner })
      } catch (error) {
        if (!isDuplicateKey(error)) throw error
        const [existing] = await tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.ssoSubject, subject))
        if (!existing) throw error
        await tx.update(appUser).set({ name, initials: initialsOf(name) }).where(eq(appUser.id, existing.id))
      }
      const [row] = await tx.select({ id: appUser.id, name: appUser.name, role: appUser.role, isSystemOwner: appUser.isSystemOwner, isBusinessOwner: appUser.isBusinessOwner, active: appUser.active }).from(appUser).where(eq(appUser.ssoSubject, subject))
      if (!row?.active) throw new UnauthorizedException('비활성 계정은 로그인할 수 없습니다')
      return row!
    })
  }
}
