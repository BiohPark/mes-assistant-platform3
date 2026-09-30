import { Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, Post, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import { eq } from 'drizzle-orm'
import type { AuthedRequest } from '../auth/guards.js'
import { DB, type Db } from '../db/db.module.js'
import { thread } from '../db/schema.js'
import { EventsService, type StoredEvent } from './events.service.js'

@Controller('events')
export class EventsController {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}

  @Get()
  stream(@Res() res: Response, @Headers('last-event-id') lastId?: string) {
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
    const send = (event: StoredEvent) => write(`id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)
    const pending: StoredEvent[] = []
    let ready = false
    unsubscribe = this.events.subscribe((event) => { if (ready) send(event); else pending.push(event) })
    const replay = this.events.replay(lastId)
    if (!lastId || replay.resync) write(`id: ${this.events.cursor()}\nevent: resync\ndata: {}\n\n`)
    else for (const event of replay.events) send(event)
    const replayed = new Set(replay.events.map((event) => event.id))
    for (const event of pending) if (!replayed.has(event.id)) send(event)
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
    this.events.typing(id, req.user!.id, req.user!.name)
  }
}
