import { randomUUID } from 'node:crypto'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module.js'
import { notification } from '../db/schema.js'
import { EventsService } from '../events/events.service.js'

@Injectable()
export class NotificationsService {
  constructor(@Inject(DB) private readonly db: Db, @Inject(EventsService) private readonly events: EventsService) {}

  async send(userIds: string[], actor: string, title: string, body: string, link: string) {
    const targets = [...new Set(userIds)].filter((userId) => userId && userId !== actor)
    if (!targets.length) return
    const rows = targets.map((userId) => ({ id: randomUUID(), userId, title, body, link }))
    await this.db.insert(notification).values(rows)
    for (const row of rows) this.events.publish('notification.created', { id: row.id, userId: row.userId })
  }

  async list(userId: string) {
    const rows = await this.db.select().from(notification).where(eq(notification.userId, userId)).orderBy(desc(notification.at), desc(notification.id))
    return rows.map((row) => ({ id: row.id, userId: row.userId, title: row.title, body: row.body, link: row.link, at: row.at.toISOString(), read: !!row.readAt }))
  }

  async unreadCount(userId: string) {
    const [row] = await this.db.select({ count: sql<number>`count(*)` }).from(notification).where(and(eq(notification.userId, userId), isNull(notification.readAt)))
    return Number(row?.count ?? 0)
  }

  async markRead(userId: string, id: string) {
    const [row] = await this.db.select({ id: notification.id }).from(notification).where(and(eq(notification.id, id), eq(notification.userId, userId)))
    if (!row) throw new NotFoundException('알림을 찾을 수 없습니다')
    await this.db.update(notification).set({ readAt: new Date() }).where(and(eq(notification.id, id), eq(notification.userId, userId), isNull(notification.readAt)))
  }

  async markAllRead(userId: string) {
    await this.db.update(notification).set({ readAt: new Date() }).where(and(eq(notification.userId, userId), isNull(notification.readAt)))
  }
}
