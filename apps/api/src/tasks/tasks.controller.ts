import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common'
import type { AuthedRequest } from '../auth/guards.js'
import { DbTasksService } from './tasks.service.js'
import { TaskExtrasService } from './task-extras.service.js'
import { z } from 'zod'
import { CONFIG, type AppConfig } from '../config/config.js'

const createSchema = z.object({
  assistantId: z.string().min(1), ownerId: z.string().min(1).optional(), assigneeIds: z.array(z.string().min(1)).optional(), tags: z.array(z.string()).optional(), title: z.string().optional(),
  referenceTaskId: z.string().optional(), inputFileIds: z.array(z.string()).optional(), firstMessage: z.string().trim().min(1).optional(),
}).strict()
const patchSchema = z.object({
  title: z.string().optional(), summary: z.string().optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  dueDate: z.iso.date().nullable().optional(), assigneeIds: z.array(z.string()).optional(), ownerId: z.string().optional(),
  modelId: z.string().nullable().optional(),
}).strict()
const statusSchema = z.object({ status: z.enum(['todo', 'in_progress', 'on_hold', 'done']), reason: z.string().optional() }).strict()
const checklistSchema = z.object({ label: z.string().trim().min(1), required: z.boolean().optional() }).strict()
const noteSchema = z.object({ content: z.string(), attachmentIds: z.array(z.string().min(1)).optional() }).strict()
const feedbackSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().default('') }).strict()
const completeSchema = z.object({ feedback: feedbackSchema.optional(), reason: z.string().max(500).optional() }).strict()
const messageSchema = z.object({ content: z.string().trim(), kind: z.literal('discussion'), attachmentIds: z.array(z.string().min(1)).optional() }).strict().refine((value) => !!value.content || !!value.attachmentIds?.length)
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) throw new BadRequestException('요청 형식이 올바르지 않습니다')
  return result.data
}
const values = (value: unknown): string[] => value === undefined ? [] : Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' ? [value] : []

@Controller('tasks')
export class TasksController {
  constructor(@Inject(DbTasksService) private readonly tasks: DbTasksService, @Inject(TaskExtrasService) private readonly extras: TaskExtrasService) {}

  @Post()
  async create(@Req() req: AuthedRequest, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    const input = parse(createSchema, body)
    const created = await (key ? this.tasks.create(req.user!.id, input, key) : this.tasks.create(req.user!.id, input))
    return { ...created.task, ...(created.warnings?.length && { warnings: created.warnings }) }
  }

  @Get()
  list(@Req() req: AuthedRequest, @Query() query: Record<string, unknown>) {
    return this.tasks.list({ assistantId: typeof query.assistantId === 'string' ? query.assistantId : undefined,
      status: values(query['status[]'] ?? query.status), tags: values(query['tag[]'] ?? query.tag),
      mine: query.mine === 'true' ? req.user!.id : undefined }, req.user!.id)
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) { return this.tasks.get(id, req.user!.id) }

  @Patch(':id')
  update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.tasks.update(req.user!.id, id, parse(patchSchema, body))
  }

  @Post(':id/status')
  setStatus(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const { status, reason } = parse(statusSchema, body)
    return this.tasks.setStatus(req.user!.id, id, status, reason)
  }

  @Get(':id/checklist')
  checklist(@Req() req: AuthedRequest, @Param('id') id: string) { return this.extras.checklist(req.user!.id, id) }

  @Post(':id/checklist')
  addChecklist(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(checklistSchema, body)
    return this.extras.addChecklist(req.user!.id, id, input.label, input.required)
  }

  @Patch(':id/checklist/:itemId')
  toggleChecklist(@Req() req: AuthedRequest, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.extras.toggleChecklist(req.user!.id, id, itemId)
  }

  @Delete(':id/checklist/:itemId')
  @HttpCode(204)
  removeChecklist(@Req() req: AuthedRequest, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.extras.removeChecklist(req.user!.id, id, itemId)
  }

  @Post(':id/checklist/review')
  reviewChecklist(@Req() req: AuthedRequest, @Param('id') id: string) { return this.extras.review(req.user!.id, id) }

  @Post(':id/checklist/review/apply')
  applyChecklistReview(@Req() req: AuthedRequest, @Param('id') id: string) { return this.extras.applyReview(req.user!.id, id) }

  @Get(':id/notes')
  notes(@Req() req: AuthedRequest, @Param('id') id: string) { return this.extras.notes(req.user!.id, id) }

  @Post(':id/notes')
  addNote(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(noteSchema, body)
    return this.extras.addNote(req.user!.id, id, input.content, input.attachmentIds)
  }

  @Delete(':id/notes/:noteId')
  @HttpCode(204)
  deleteNote(@Req() req: AuthedRequest, @Param('id') id: string, @Param('noteId') noteId: string) { return this.extras.deleteNote(req.user!.id, id, noteId) }

  @Post(':id/complete/preview')
  preview(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(completeSchema, body)
    return this.extras.preview(req.user!.id, id, input.feedback, input.reason)
  }

  @Post(':id/complete')
  complete(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(completeSchema, body)
    return this.extras.complete(req.user!.id, id, input.feedback, input.reason)
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Req() req: AuthedRequest, @Param('id') id: string) { return this.tasks.delete(id, req.user!.id) }

  @Put(':id/tags/:tag')
  @HttpCode(204)
  addTag(@Req() req: AuthedRequest, @Param('id') id: string, @Param('tag') tag: string) {
    return this.tasks.addTag(req.user!.id, id, tag)
  }

  @Delete(':id/tags/:tag')
  @HttpCode(204)
  removeTag(@Req() req: AuthedRequest, @Param('id') id: string, @Param('tag') tag: string) {
    return this.tasks.removeTag(req.user!.id, id, tag)
  }

  @Get(':id/activity')
  activity(@Req() req: AuthedRequest, @Param('id') id: string) { return this.tasks.activity(id, req.user!.id) }
}

@Controller('tags')
export class TagsController {
  constructor(@Inject(DbTasksService) private readonly tasks: DbTasksService) {}

  @Get('suggest')
  suggest(@Query() query: Record<string, unknown>) {
    return this.tasks.suggestions(typeof query.prefix === 'string' ? query.prefix : '', values(query['exclude[]'] ?? query.exclude))
  }
}

@Controller('threads')
export class ThreadsController {
  constructor(@Inject(DbTasksService) private readonly tasks: DbTasksService, @Inject(CONFIG) private readonly config: AppConfig) {}

  @Get(':id/messages')
  async messages(@Req() req: AuthedRequest, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    const rows = await this.tasks.messages(id, req.user!.id)
    const ids = values(query.ids)
    if (!ids.length) return rows
    const selected = new Set(ids.flatMap((value) => value.split(',')).filter(Boolean))
    return rows.filter((row) => selected.has(row.id))
  }

  @Post(':id/messages')
  append(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const result = messageSchema.safeParse(body)
    if (!result.success) throw new BadRequestException('AI 요청은 S3에서 지원합니다')
    if ((result.data.attachmentIds?.length ?? 0) > this.config.fileMaxPerRequest) throw new BadRequestException('첨부 파일 개수 한도를 초과했습니다')
    return this.tasks.appendMessage(req.user!.id, id, result.data)
  }
}
