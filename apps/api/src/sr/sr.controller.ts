import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common'
import { z } from 'zod'
import type { AuthedRequest } from '../auth/guards.js'
import { SrService } from './sr.service.js'

const submitSchema = z.object({ title: z.string(), titleSource: z.enum(['ai', 'manual']).optional(), body: z.string(), attachmentIds: z.array(z.string()).optional() }).strict()
const titleSchema = z.object({ title: z.string() }).strict()
const statusSchema = z.object({ status: z.enum(['submitted', 'reviewing', 'in_progress', 'responded', 'done', 'rejected']) }).strict()
const taskSchema = z.object({ assistantId: z.string().min(1), forceNew: z.boolean().optional() }).strict()
const resultSchema = z.object({ taskId: z.string().optional(), text: z.string().optional(), fileIds: z.array(z.string()).optional() }).strict()
const contentSchema = z.object({ title: z.string(), body: z.string(), attachmentIds: z.array(z.string()), titleSource: z.enum(['ai', 'manual']).optional() }).strict()
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
  list(@Req() req: AuthedRequest) { return this.sr.list(req.user!.id) }
  @Post()
  create(@Req() req: AuthedRequest) { return this.sr.create(req.user!.id) }
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
  status(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { return this.sr.status(req.user!.id, id, parse(statusSchema, body).status) }
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
