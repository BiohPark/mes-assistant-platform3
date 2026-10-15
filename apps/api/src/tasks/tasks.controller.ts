import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, HttpException, Inject, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import type { AuthedRequest } from '../auth/guards.js'
import { DbTasksService } from './tasks.service.js'
import { TaskExtrasService } from './task-extras.service.js'
import { TaskBriefService } from './task-brief.service.js'
import { SrInputsService } from './sr-inputs.service.js'
import { z } from 'zod'
import { taskListQuerySchema } from '@mes/contracts'
import { decodeTaskCursor, type TaskFilter } from './task-listing.js'
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
  constructor(@Inject(DbTasksService) private readonly tasks: DbTasksService, @Inject(TaskExtrasService) private readonly extras: TaskExtrasService,
    @Inject(TaskBriefService) private readonly brief: TaskBriefService) {}

  @Post()
  async create(@Req() req: AuthedRequest, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    const input = parse(createSchema, body)
    const created = await (key ? this.tasks.create(req.user!.id, input, key) : this.tasks.create(req.user!.id, input))
    return { ...created.task, ...(created.warnings?.length && { warnings: created.warnings }) }
  }

  private listFilter(query: Record<string, unknown>, actor: string): TaskFilter {
    // Reject malformed arrays/objects for scalar controls instead of silently ignoring them.
    for (const key of ['assistantId', 'mine', 'limit', 'cursor', 'q', 'activeWithinDays', 'view']) {
      if (Object.keys(query).some(name => name.startsWith(`${key}[`)) || (query[key] !== undefined && typeof query[key] !== 'string')) throw new BadRequestException('요청 형식이 올바르지 않습니다')
    }
    const input = parse(taskListQuerySchema, {
      ...query, status: values(query['status[]'] ?? query.status), tags: values(query['tag[]'] ?? query.tag), ai: values(query['ai[]'] ?? query.ai),
    })
    if (input.cursor) decodeTaskCursor(input.cursor)
    return {
      assistantId: input.assistantId, status: input.status, tags: input.tags, mine: input.mine === 'true' ? actor : undefined,
      ...(input.limit !== undefined && { limit: input.limit }), ...(input.cursor !== undefined && { cursor: input.cursor }),
      ...(input.q !== undefined && { q: input.q }), ...(input.ai?.length && { ai: input.ai }),
      ...(input.activeWithinDays !== undefined && { activeWithinDays: input.activeWithinDays }), ...(input.view && { view: input.view }),
    }
  }

  @Get()
  async list(@Req() req: AuthedRequest, @Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const filter = this.listFilter(query, req.user!.id)
    if (!['limit', 'cursor', 'q', 'ai', 'ai[]', 'activeWithinDays', 'view'].some(key => query[key] !== undefined)) {
      return this.tasks.list(filter, req.user!.id)
    }
    const page = await this.tasks.listPage(filter, req.user!.id)
    if (page.nextCursor) res.setHeader('X-Next-Cursor', page.nextCursor)
    return page.items
  }

  @Get('board')
  board(@Req() req: AuthedRequest, @Query() query: Record<string, unknown>) {
    return this.tasks.board(this.listFilter(query, req.user!.id), req.user!.id)
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

  /** 대화 요약 카드(표시 전용) — 필요하면 백그라운드 생성을 걸고 지금 있는 것을 바로 돌려준다 */
  @Get(':id/brief')
  getBrief(@Req() req: AuthedRequest, @Param('id') id: string) { return this.brief.get(req.user!.id, id) }

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
  async reviewChecklist(@Req() req: AuthedRequest, @Param('id') id: string, @Headers('accept') accept: string | undefined, @Res() res: Response) {
    if (!accept?.includes('text/event-stream')) {
      res.status(201).json(await this.extras.review(req.user!.id, id))
      return
    }
    const controller = new AbortController()
    const close = () => { if (!res.writableEnded) controller.abort() }
    res.on('close', close)
    const emit = (event: string, data: unknown) => {
      if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
    try {
      const result = await this.extras.review(req.user!.id, id, {
        signal: controller.signal,
        onStart: () => {
          res.status(201).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
          res.flushHeaders()
          emit('started', {})
        },
        onItem: (item) => emit('item', item),
      })
      emit('completed', result)
      res.end()
    } catch (error) {
      if (!res.headersSent && !res.destroyed) throw error
      emit('failed', { error: error instanceof HttpException ? error.message : '달성도 점검에 실패했습니다' })
      res.end()
    } finally { res.off('close', close) }
  }

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

@Controller('tasks/:id/sr-inputs')
export class SrInputsController {
  constructor(@Inject(SrInputsService) private readonly inputs: SrInputsService) {}
  @Get()
  list(@Req() req: AuthedRequest, @Param('id') id: string) { return this.inputs.list(req.user!.id, id) }
  @Put(':srId')
  @HttpCode(204)
  select(@Req() req: AuthedRequest, @Param('id') id: string, @Param('srId') srId: string) { return this.inputs.select(req.user!.id, id, srId) }
  @Delete(':srId')
  @HttpCode(204)
  remove(@Req() req: AuthedRequest, @Param('id') id: string, @Param('srId') srId: string) { return this.inputs.remove(req.user!.id, id, srId) }
}

@Controller('tags')
export class TagsController {
  constructor(@Inject(DbTasksService) private readonly tasks: DbTasksService) {}

  @Get('suggest')
  suggest(@Req() req: AuthedRequest, @Query() query: Record<string, unknown>) {
    return this.tasks.suggestions(req.user!.id, typeof query.prefix === 'string' ? query.prefix : '', values(query['exclude[]'] ?? query.exclude))
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
