import { randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { DB, type Db } from '../db/db.module.js'
import { notification } from '../db/schema.js'
import { EventsService } from '../events/events.service.js'

@Injectable()
export class SrNotificationsService {
  constructor(@Inject(DB) private readonly db: Db, @Inject(EventsService) private readonly events: EventsService) {}

  async send(userId: string, actor: string, title: string, body: string, link: string) {
    if (userId === actor) return
    const id = randomUUID()
    await this.db.insert(notification).values({ id, userId, title, body, link })
    this.events.publish('notification.created', { id, userId })
  }
}
