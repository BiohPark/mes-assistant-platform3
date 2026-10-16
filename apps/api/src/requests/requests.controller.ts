import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import { z } from 'zod'
import type { AuthedRequest } from '../auth/guards.js'
import { RequestsService } from './requests.service.js'
import { writeEvent } from './sse.js'

const startSchema = z.object({ content: z.string(), attachmentIds: z.array(z.string().min(1)).optional(), oneShotFileIds: z.array(z.string().min(1)).optional() }).strict()
const retrySchema = z.object({ excludeFileIds: z.array(z.string().min(1)).optional(), forceInlineFileIds: z.array(z.string().min(1)).optional() }).strict()
const estimateSchema = z.object({ draft: z.string().optional(), attachmentIds: z.array(z.string().min(1)).optional(), oneShotFileIds: z.array(z.string().min(1)).optional() }).strict()
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new BadRequestException('요청 형식이 올바르지 않습니다')
  return parsed.data
}

/** 응답 스트림 생존 주석 간격 — 도구 실행처럼 몇 분씩 청크가 없어도 프록시가 유휴 연결로 끊지 않게 한다(/api/events와 같은 15초) */
export const STREAM_HEARTBEAT_MS = 15_000

export function stream(res: Response, requests: Pick<RequestsService, 'subscribe'>, id: string): void {
  res.status(201).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  let finished = false
  const heartbeat = setInterval(() => { if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n') }, STREAM_HEARTBEAT_MS)
  heartbeat.unref?.()
  const unsubscribe = requests.subscribe(id, (event) => {
    writeEvent(res, event)
    if (event.event === 'completed' || event.event === 'failed') { finished = true; clearInterval(heartbeat); res.end() }
  })
  const stop = () => { clearInterval(heartbeat); unsubscribe() }
  if (finished) stop()
  res.on('close', stop)
}

@Controller('threads/:threadId/requests')
export class ThreadRequestsController {
  constructor(@Inject(RequestsService) private readonly requests: RequestsService) {}

  @Post()
  async start(@Req() req: AuthedRequest, @Param('threadId') threadId: string, @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown, @Res() res: Response) {
    const started = await this.requests.start(req.user!.id, threadId, parse(startSchema, body), key ?? '')
    stream(res, this.requests, started.id)
  }

  @Post('estimate')
  estimate(@Req() req: AuthedRequest, @Param('threadId') threadId: string, @Body() body: unknown) {
    return this.requests.estimate(req.user!.id, threadId, parse(estimateSchema, body ?? {}))
  }
}

@Controller('requests')
export class RequestsController {
  constructor(@Inject(RequestsService) private readonly requests: RequestsService) {}

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) { return this.requests.get(id, req.user!.id) }

  @Get(':id/snapshot')
  async snapshot(@Req() req: AuthedRequest, @Param('id') id: string, @Res() res: Response) {
    const data = await this.requests.snapshot(id, req.user!.id)
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="request-${id.replace(/[^a-zA-Z0-9-]/g, '')}.json"` })
    res.send(JSON.stringify(data, null, 2))
  }

  @Post(':id/cancel')
  @HttpCode(204)
  cancel(@Req() req: AuthedRequest, @Param('id') id: string) { return this.requests.cancel(id, req.user!.id) }

  @Post(':id/retry')
  async retry(@Req() req: AuthedRequest, @Param('id') id: string, @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown, @Res() res: Response) {
    const started = await this.requests.retry(req.user!.id, id, parse(retrySchema, body ?? {}), key ?? '')
    stream(res, this.requests, started.id)
  }
}
