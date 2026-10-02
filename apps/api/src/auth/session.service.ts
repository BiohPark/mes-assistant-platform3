import { createHash, randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, gt, sql } from 'drizzle-orm'
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
    const [clock] = await this.db.select({ now: sql<Date>`current_timestamp(6)`.mapWith(appSession.createdAt) }).from(appUser).where(eq(appUser.id, userId))
    if (!clock) throw new Error('세션 사용자를 찾을 수 없습니다')
    const expiresAt = new Date(clock.now.getTime() + this.config.sessionTtlHours * 3600_000)
    const idleExpiresAt = new Date(Math.min(expiresAt.getTime(), clock.now.getTime() + this.config.sessionIdleHours * 3600_000))
    await this.db.insert(appSession).values({ id: hashToken(token), userId, createdAt: clock.now, expiresAt: idleExpiresAt })
    return { token, expiresAt }
  }

  async resolve(token: string): Promise<AuthUser | null> {
    const [row] = await this.db
      .select({ id: appUser.id, name: appUser.name, role: appUser.role, isSystemOwner: appUser.isSystemOwner, isBusinessOwner: appUser.isBusinessOwner, mustChangePassword: appUser.mustChangePassword, createdAt: appSession.createdAt, now: sql<Date>`current_timestamp(6)`.mapWith(appSession.createdAt) })
      .from(appSession)
      .innerJoin(appUser, eq(appUser.id, appSession.userId))
      .where(and(eq(appSession.id, hashToken(token)), gt(appSession.expiresAt, sql`current_timestamp(6)`), eq(appUser.active, true)))
    if (!row) return null
    const absoluteExpiry = row.createdAt.getTime() + this.config.sessionTtlHours * 3600_000
    if (absoluteExpiry <= row.now.getTime()) return null
    const expiresAt = new Date(Math.min(absoluteExpiry, row.now.getTime() + this.config.sessionIdleHours * 3600_000))
    const updated = await this.db.update(appSession).set({ expiresAt }).where(and(eq(appSession.id, hashToken(token)), gt(appSession.expiresAt, sql`current_timestamp(6)`)))
    if (!updated[0].affectedRows) return null
    const { createdAt: _createdAt, now: _now, ...user } = row
    return user
  }

  async destroy(token: string) {
    await this.db.delete(appSession).where(eq(appSession.id, hashToken(token)))
  }
}
