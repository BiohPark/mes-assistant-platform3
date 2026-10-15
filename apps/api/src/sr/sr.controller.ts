import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, HttpException, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import { z } from 'zod'
import { SR_MANUAL_STATUSES } from '@mes/domain'
import type { AuthedRequest } from '../auth/guards.js'
import type { SrAiStreamOptions } from '../requests/requests.service.js'
import { SrService } from './sr.service.js'

const submitSchema = z.object({ title: z.string(), titleSource: z.enum(['ai', 'manual']).optional(), body: z.string(), attachmentIds: z.array(z.string()).optional(), updatedAt: z.iso.datetime().optional() }).strict()
const titleSchema = z.object({ title: z.string() }).strict()
/** 수동 변경은 완료·반려·다시 열기(in_progress)만. 접수됨·결과 공유는 자동 전환으로만 들어간다. */
const statusSchema = z.object({ status: z.enum(SR_MANUAL_STATUSES), reason: z.string().max(500).optional() }).strict()
const refineSchema = z.object({ title: z.string(), body: z.string() }).strict()
const taskSchema = z.object({ assistantId: z.string().min(1), forceNew: z.boolean().optional() }).strict()
const resultSchema = z.object({ taskId: z.string().optional(), text: z.string().optional(), fileIds: z.array(z.string()).optional() }).strict()
const contentSchema = z.object({ title: z.string(), body: z.string(), attachmentIds: z.array(z.string()), titleSource: z.enum(['ai', 'manual']).optional(), updatedAt: z.iso.datetime().optional() }).strict()
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new BadRequestException('요청 형식이 올바르지 않습니다')
  return result.data
}
@Controller('service-requests')
export class SrController {
  constructor(@Inject(SrService) private readonly sr: SrService) {}
  @Get('intake-assistant')
  intakeAssistant() { return this.sr.intakeAssistant() }
  @Get()
  list(@Req() req: AuthedRequest, @Query('scope') scope?: string) {
    if (scope === undefined) return this.sr.list(req.user!.id)
    return this.sr.list(req.user!.id, parse(z.enum(['mine', 'inbox']), scope))
  }
  @Post()
  create(@Req() req: AuthedRequest, @Headers('idempotency-key') key?: string) {
    if (key === undefined) return this.sr.create(req.user!.id)
    return this.sr.create(req.user!.id, parse(z.string().trim().min(1).max(128), key))
  }
  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) { return this.sr.get(req.user!.id, id) }
  @Get(':id/draft')
  draft(@Req() req: AuthedRequest, @Param('id') id: string) { return this.sr.draft(req.user!.id, id) }
  @Post(':id/submit')
  submit(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { return this.sr.submit(req.user!.id, id, parse(submitSchema, body)) }
  @Patch(':id/title')
  title(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { return this.sr.title(req.user!.id, id, parse(titleSchema, body).title) }
  @Patch(':id/content')
  content(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { return this.sr.content(req.user!.id, id, parse(contentSchema, body)) }
  @Patch(':id/status')
  status(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { const input = parse(statusSchema, body); return this.sr.status(req.user!.id, id, input.status, input.reason) }
  /** AI 자동작성 제안 — Accept: text/event-stream이면 started·delta·completed/failed로 진행을 보낸다(달성도 점검과 같은 패턴). */
  @Post(':id/compose')
  compose(@Req() req: AuthedRequest, @Param('id') id: string, @Headers('accept') accept: string | undefined, @Res() res: Response) {
    return this.proposal(accept, res, (options) => this.sr.compose(req.user!.id, id, options), 'AI 자동작성에 실패했습니다')
  }
  @Post(':id/refine')
  refine(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown, @Headers('accept') accept: string | undefined, @Res() res: Response) {
    const input = parse(refineSchema, body)
    return this.proposal(accept, res, (options) => this.sr.refine(req.user!.id, id, input, options), 'AI 다듬기에 실패했습니다')
  }
  /** 제안 공통 응답 — JSON(201) 또는 SSE. 슬롯·권한 오류는 헤더 전송 전에 그대로 던져 JSON 오류로 나간다. */
  private async proposal(accept: string | undefined, res: Response, run: (options: SrAiStreamOptions) => Promise<unknown>, failure: string) {
    if (!accept?.includes('text/event-stream')) {
      res.status(201).json(await run({}))
      return
    }
    const controller = new AbortController()
    const close = () => { if (!res.writableEnded) controller.abort() }
    res.on('close', close)
    const emit = (event: string, data: unknown) => {
      if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
    try {
      const result = await run({
        signal: controller.signal,
        onStart: () => {
          res.status(201).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
          res.flushHeaders()
          emit('started', {})
        },
        onDelta: (text) => emit('delta', { text }),
      })
      emit('completed', result)
      res.end()
    } catch (error) {
      if (!res.headersSent && !res.destroyed) throw error
      emit('failed', { error: error instanceof HttpException ? error.message : failure })
      res.end()
    } finally { res.off('close', close) }
  }
  @Delete(':id')
  @HttpCode(204)
  delete(@Req() req: AuthedRequest, @Param('id') id: string) { return this.sr.delete(req.user!.id, id) }
  @Post(':id/tasks')
  startTask(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { return this.sr.startTask(req.user!.id, id, parse(taskSchema, body)) }
  @Post(':id/results')
  share(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { return this.sr.share(req.user!.id, id, parse(resultSchema, body)) }
  @Get(':id/results')
  results(@Req() req: AuthedRequest, @Param('id') id: string) { return this.sr.results(req.user!.id, id) }
}
