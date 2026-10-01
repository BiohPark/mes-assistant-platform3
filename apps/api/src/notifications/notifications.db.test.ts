import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/mysql2'
import { eq } from 'drizzle-orm'
import { createPool } from '../db/connection.js'
import type { Db } from '../db/db.module.js'
import type { Pool } from 'mysql2/promise'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { appUser, assistant, notification } from '../db/schema.js'
import { createTempDb } from '../test/tempDb.js'
import { DbTasksService } from '../tasks/tasks.service.js'
import { NotificationsService } from './notifications.service.js'

describe('notifications DB (demo notifications 30/44)', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  let db: Db
  let notifications: NotificationsService
  beforeAll(async () => {
    temp = await createTempDb('notifications')
    await runMigrations(temp.url)
    client = createPool(temp.url)
    db = drizzle(client)
    await seedCatalog(db)
    await db.insert(appUser).values([{ id: 'assignee', name: '담당자', initials: '담', color: '#000' }, { id: 'other', name: '타인', initials: '타', color: '#000' }])
    notifications = new NotificationsService(db, { publish: () => undefined } as never)
  })
  afterAll(async () => { await client?.end(); await temp?.drop() })

  it('대화 생성 시 소유자·담당자에게 한 번씩 알리고 행위자는 제외한다', async () => {
    const [selected] = await db.select().from(assistant)
    const service = new DbTasksService(db, { publish: () => undefined } as never, undefined, notifications)
    const created = await service.create('assignee', { assistantId: selected!.id, ownerId: selected!.ownerId, assigneeIds: ['assignee', selected!.ownerId, 'other', 'other'] })
    expect(await db.select().from(notification).where(eq(notification.userId, 'assignee'))).toHaveLength(0)
    const others = await db.select().from(notification).where(eq(notification.userId, 'other'))
    expect(others).toHaveLength(1)
    expect(others[0]).toMatchObject({ link: `/c/${created.task.id}`, readAt: null })
    expect(await db.select().from(notification).where(eq(notification.userId, selected!.ownerId))).toHaveLength(1)
  })

  it('본인 알림만 조회·읽기 처리하고 전체 읽음 수를 갱신한다', async () => {
    await notifications.send(['other'], 'assignee', '추가 알림', '', '/sr')
    const mine = await notifications.list('other')
    expect(mine).toHaveLength(2)
    expect(mine[0]).toMatchObject({ title: '추가 알림', read: false })
    expect(await notifications.unreadCount('other')).toBe(2)
    await expect(notifications.markRead('assignee', mine[0]!.id)).rejects.toThrow()
    await notifications.markRead('other', mine[0]!.id)
    expect(await notifications.unreadCount('other')).toBe(1)
    await notifications.markAllRead('other')
    expect(await notifications.unreadCount('other')).toBe(0)
    expect((await notifications.list('other')).every((row) => row.read)).toBe(true)
  })
})
