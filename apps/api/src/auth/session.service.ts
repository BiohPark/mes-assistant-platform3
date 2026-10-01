import { createHash, randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, gt } from 'drizzle-orm'
import { CONFIG, type AppConfig } from '../config/config.js'
import { DB, type Db } from '../db/db.module.js'
import { appSession, appUser } from '../db/schema.js'

export interface AuthUser {
  id: string
  name: string
  role: string
  isSystemOwner: boolean
  isBusinessOwner?: boolean
  mustChangePassword?: boolean
}

export interface SessionStore {
  create(userId: string): Promise<{ token: string; expiresAt: Date }>
  resolve(token: string): Promise<AuthUser | null>
  destroy(token: string): Promise<void>
  destroyUserSessions?(userId: string): Promise<void>
}

export const SESSION_STORE = Symbol('SESSION_STORE')
export const SESSION_COOKIE = 'mes_session'

/** 쿠키에는 무작위 토큰, DB에는 그 해시만 둔다 (DB가 새어도 세션을 가로챌 수 없게) */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

@Injectable()
export class DbSessionStore implements SessionStore {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async create(userId: string) {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 3600_000)
    await this.db.insert(appSession).values({ id: hashToken(token), userId, expiresAt })
    return { token, expiresAt }
  }

  async resolve(token: string): Promise<AuthUser | null> {
    const [row] = await this.db
      .select({ id: appUser.id, name: appUser.name, role: appUser.role, isSystemOwner: appUser.isSystemOwner, isBusinessOwner: appUser.isBusinessOwner, mustChangePassword: appUser.mustChangePassword })
      .from(appSession)
      .innerJoin(appUser, eq(appUser.id, appSession.userId))
      .where(and(eq(appSession.id, hashToken(token)), gt(appSession.expiresAt, new Date()), eq(appUser.active, true)))
    return row ?? null
  }

  async destroy(token: string) {
    await this.db.delete(appSession).where(eq(appSession.id, hashToken(token)))
  }
}
