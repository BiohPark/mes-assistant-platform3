import { randomBytes } from 'node:crypto'
import { ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { eq, sql } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module.js'
import { appSession, appUser } from '../db/schema.js'
import { hashPassword, verifyPassword } from '../auth/password.js'

@Injectable()
export class AccountsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async users() {
    return this.db.select({ id: appUser.id, loginId: appUser.loginId, name: appUser.name, active: appUser.active,
      isSystemOwner: appUser.isSystemOwner, isBusinessOwner: appUser.isBusinessOwner,
      mustChangePassword: appUser.mustChangePassword }).from(appUser).orderBy(appUser.name)
  }
  async role(id: string, field: 'isSystemOwner' | 'isBusinessOwner', enabled: boolean) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`insert into db_lock (lock_key) values ('system-owner') on duplicate key update lock_key = lock_key`)
      const [row] = await tx.select().from(appUser).where(eq(appUser.id, id)).for('update')
      if (!row) throw new NotFoundException('사용자를 찾을 수 없습니다')
      if (field === 'isSystemOwner' && row.isSystemOwner && !enabled) {
        const [another] = await tx.select({ id: appUser.id }).from(appUser).where(sql`${appUser.isSystemOwner} = true and ${appUser.active} = true and ${appUser.id} <> ${id}`).limit(1)
        if (!another) throw new ConflictException('마지막 System Owner는 해제할 수 없습니다')
      }
      await tx.update(appUser).set({ [field]: enabled }).where(eq(appUser.id, id))
    })
  }
  async active(id: string, enabled: boolean) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`insert into db_lock (lock_key) values ('system-owner') on duplicate key update lock_key = lock_key`)
      const [row] = await tx.select().from(appUser).where(eq(appUser.id, id)).for('update')
      if (!row) throw new NotFoundException('사용자를 찾을 수 없습니다')
      if (row.isSystemOwner && row.active && !enabled) {
        const [another] = await tx.select({ id: appUser.id }).from(appUser).where(sql`${appUser.isSystemOwner} = true and ${appUser.active} = true and ${appUser.id} <> ${id}`).limit(1)
        if (!another) throw new ConflictException('마지막 System Owner는 비활성화할 수 없습니다')
      }
      await tx.update(appUser).set({ active: enabled }).where(eq(appUser.id, id))
      if (!enabled) await tx.delete(appSession).where(eq(appSession.userId, id))
    })
  }
  async temporaryPassword(id: string) {
    const password = randomBytes(18).toString('base64url')
    const hash = await hashPassword(password)
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(appUser).where(eq(appUser.id, id)).for('update')
      if (!row) throw new NotFoundException('사용자를 찾을 수 없습니다')
      if (!row.loginId) throw new ConflictException('앱 자체 로그인 계정만 재설정할 수 있습니다')
      await tx.update(appUser).set({ passwordHash: hash, mustChangePassword: true }).where(eq(appUser.id, id))
      await tx.delete(appSession).where(eq(appSession.userId, id))
    })
    return { temporaryPassword: password }
  }
  async changePassword(id: string, currentPassword: string, newPassword: string) {
    const hash = await hashPassword(newPassword)
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(appUser).where(eq(appUser.id, id)).for('update')
      if (!row?.passwordHash || !await verifyPassword(currentPassword, row.passwordHash)) throw new UnauthorizedException('현재 비밀번호가 올바르지 않습니다')
      await tx.update(appUser).set({ passwordHash: hash, mustChangePassword: false }).where(eq(appUser.id, id))
      await tx.delete(appSession).where(eq(appSession.userId, id))
    })
  }
}
