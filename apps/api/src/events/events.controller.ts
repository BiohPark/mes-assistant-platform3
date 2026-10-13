import { Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, Post, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import { eq } from 'drizzle-orm'
import type { AuthedRequest } from '../auth/guards.js'
import { DB, type Db } from '../db/db.module.js'
import { thread } from '../db/schema.js'
import { EventsService, type StoredEvent } from './events.service.js'
import { assertSrAccess, assertThreadAccess } from '../sr/access.js'

@Controller('events')
export class EventsController {
  constructor(@Inject(EventsService) private readonly events: EventsService, @Inject(DB) private readonly db: Db) {}

  private async visible(actor: string, event: StoredEvent) {
    if (event.event === 'sr.updated') {
      try { await assertSrAccess(this.db, actor, event.data.srId); return true }
      catch { return false }
    }
    if (event.event === 'notification.created') return event.data.userId === actor
    if (event.event !== 'message.appended' && event.event !== 'request.updated' && event.event !== 'presence.typing') return true
    const [owner] = await this.db.select({ srId: thread.srId }).from(thread).where(eq(thread.id, event.data.threadId))
    if (!owner?.srId) return true
    try { await assertSrAccess(this.db, actor, owner.srId); return true }
    catch { return false }
  }

  @Get()
  async stream(@Req() req: AuthedRequest, @Res() res: Response, @Headers('last-event-id') lastId?: string) {
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.flushHeaders()
    let closed = false
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let unsubscribe: () => void = () => undefined
    const cleanup = () => {
      if (closed) return
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      unsubscribe()
    }
    res.on('close', cleanup)
    const write = (chunk: string) => { if (!closed && !res.write(chunk)) { cleanup(); res.end() } }
    const send = async (event: StoredEvent) => {
      if (await this.visible(req.user!.id, event)) write(`id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)
    }
    const pending: StoredEvent[] = []
    let ready = false
    let delivery = Promise.resolve()
    unsubscribe = this.events.subscribe((event) => {
      if (ready) delivery = delivery.then(() => send(event)).catch(() => cleanup())
      else pending.push(event)
    })
    const replay = this.events.replay(lastId)
    const resync = !lastId || replay.resync
    const cursor = this.events.cursor()
    if (resync) write(`id: ${cursor}\nevent: resync\ndata: {}\n\n`)
    else for (const event of replay.events) await send(event)
    const replayed = new Set(replay.events.map((event) => event.id))
    const coveredSequence = resync ? Number(cursor.split(':')[1]) : -1
    for (const event of pending) {
      if (Number(event.id.split(':')[1]) <= coveredSequence || replayed.has(event.id)) continue
      replayed.add(event.id)
      await send(event)
    }
    ready = true
    if (!closed) {
      heartbeat = setInterval(() => write(': ping\n\n'), 15_000)
      heartbeat.unref?.()
    }
  }
}

@Controller('threads')
export class TypingController {
  constructor(@Inject(DB) private readonly db: Db, @Inject(EventsService) private readonly events: EventsService) {}

  @Post(':id/typing')
  @HttpCode(204)
  async typing(@Req() req: AuthedRequest, @Param('id') id: string) {
    const [found] = await this.db.select({ id: thread.id }).from(thread).where(eq(thread.id, id))
    if (!found) throw new NotFoundException('스레드를 찾을 수 없습니다')
    await assertThreadAccess(this.db, req.user!.id, id)
    this.events.typing(id, req.user!.id, req.user!.name)
  }
}
