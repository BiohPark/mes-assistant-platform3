import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import { z } from 'zod'
import type { AuthedRequest } from '../auth/guards.js'
import { RequestsService } from './requests.service.js'
import { writeEvent } from './sse.js'

const startSchema = z.object({ content: z.string(), attachmentIds: z.array(z.string().min(1)).optional(), oneShotFileIds: z.array(z.string().min(1)).optional() }).strict()
const retrySchema = z.object({ excludeFileIds: z.array(z.string().min(1)).optional(), forceInlineFileIds: z.array(z.string().min(1)).optional() }).strict()
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new BadRequestException('요청 형식이 올바르지 않습니다')
  return parsed.data
}

function stream(res: Response, requests: RequestsService, id: string): void {
  res.status(201).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  let finished = false
  const unsubscribe = requests.subscribe(id, (event) => {
    writeEvent(res, event)
    if (event.event === 'completed' || event.event === 'failed') { finished = true; res.end() }
  })
  if (finished) unsubscribe()
  res.on('close', unsubscribe)
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
}

@Controller('requests')
export class RequestsController {
  constructor(@Inject(RequestsService) private readonly requests: RequestsService) {}

  @Get(':id')
  get(@Param('id') id: string) { return this.requests.get(id) }

  @Get(':id/snapshot')
  async snapshot(@Param('id') id: string, @Res() res: Response) {
    const data = await this.requests.snapshot(id)
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="request-${id.replace(/[^a-zA-Z0-9-]/g, '')}.json"` })
    res.send(JSON.stringify(data, null, 2))
  }

  @Post(':id/cancel')
  @HttpCode(204)
  cancel(@Param('id') id: string) { return this.requests.cancel(id) }

  @Post(':id/retry')
  async retry(@Req() req: AuthedRequest, @Param('id') id: string, @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown, @Res() res: Response) {
    const started = await this.requests.retry(req.user!.id, id, parse(retrySchema, body ?? {}), key ?? '')
    stream(res, this.requests, started.id)
  }
}
