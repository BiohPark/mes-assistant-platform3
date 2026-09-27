import { randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { eq, sql } from 'drizzle-orm'
import { CONFIG, type AppConfig } from '../config/config.js'
import { DB, type Db } from '../db/db.module.js'
import { appUser } from '../db/schema.js'
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
  grantSystemOwner(loginId: string): Promise<AuthUser>
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
    const [row] = await this.db.insert(appUser).values({
      id, loginId, passwordHash: hash, name: loginId, initials: initialsOf(loginId), color: pickColor(id),
      isSystemOwner: this.config.initialSystemOwners.includes(loginId),
    }).onConflictDoNothing({ target: appUser.loginId }).returning({ id: appUser.id, name: appUser.name, role: appUser.role, isSystemOwner: appUser.isSystemOwner })
    return row ?? null
  }

  async findByLoginId(loginId: string) {
    const [row] = await this.db.select({
      id: appUser.id, name: appUser.name, role: appUser.role, isSystemOwner: appUser.isSystemOwner,
      hash: appUser.passwordHash, active: appUser.active,
    }).from(appUser).where(eq(appUser.loginId, loginId))
    if (!row?.hash) return null
    const { hash, active, ...user } = row
    return { user, hash, active }
  }

  async grantSystemOwner(loginId: string): Promise<AuthUser> {
    const [row] = await this.db.update(appUser).set({ isSystemOwner: true }).where(eq(appUser.loginId, loginId))
      .returning({ id: appUser.id, name: appUser.name, role: appUser.role, isSystemOwner: appUser.isSystemOwner })
    return row!
  }

  /** 첫 로그인 때 app_user를 만들고, 이후에는 이름만 IdP 값으로 맞춘다. 역할은 앱이 관리한다(D21). */
  async upsertFromClaims(claims: SsoClaims): Promise<AuthUser> {
    const name = claims.name?.trim() || claims.preferred_username || claims.sub
    const owners = this.config.initialSystemOwners
    const initialOwner = owners.includes(claims.sub) || (!!claims.preferred_username && owners.includes(claims.preferred_username))
    const id = randomUUID()
    const [row] = await this.db
      .insert(appUser)
      .values({ id, ssoSubject: ssoSubjectKey(this.config.oidc!.issuer, claims.sub), name, initials: initialsOf(name), color: pickColor(id), isSystemOwner: initialOwner })
      .onConflictDoUpdate({
        target: appUser.ssoSubject,
        // 최초 SO 목록은 부여만 한다 (앱에서 해제한 SO를 되살리지 않도록 목록에서 빼면 된다)
        set: { name, initials: initialsOf(name), isSystemOwner: initialOwner ? sql`true` : sql`${appUser.isSystemOwner}` },
      })
      .returning({ id: appUser.id, name: appUser.name, role: appUser.role, isSystemOwner: appUser.isSystemOwner })
    return row!
  }
}
