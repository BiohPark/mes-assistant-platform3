import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common'
import { z } from 'zod'
import type { AuthedRequest } from '../auth/guards.js'
import { RequestsService } from '../requests/requests.service.js'
import { DbConversationInputsService } from './conversation-inputs.service.js'

const ids = z.array(z.string().min(1).max(191))
const selectBody = z.object({ mode: z.enum(['full', 'messages', 'summary']), weight: z.enum(['main', 'reference']).optional(), messageIds: ids.optional(),
  summary: z.object({ text: z.string(), source: z.enum(['ai', 'rule']), model: z.string().optional(), messageIds: ids }).strict().optional() }).strict()
const weightBody = z.object({ weight: z.enum(['main', 'reference']) }).strict()
const draftBody = z.object({ messageIds: ids.optional() }).strict()
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) throw new BadRequestException('요청 형식이 올바르지 않습니다')
  return result.data
}

@Controller('tasks/:id/conversation-inputs')
export class ConversationInputsController {
  constructor(@Inject(DbConversationInputsService) private readonly context: DbConversationInputsService,
    @Inject(RequestsService) private readonly requests: RequestsService) {}

  @Get()
  list(@Param('id') taskId: string) { return this.context.list(taskId) }

  @Put(':sourceTaskId')
  select(@Req() req: AuthedRequest, @Param('id') taskId: string, @Param('sourceTaskId') sourceTaskId: string, @Body() body: unknown) {
    return this.context.select(req.user!.id, taskId, sourceTaskId, parse(selectBody, body))
  }

  @Patch(':sourceTaskId')
  @HttpCode(204)
  weight(@Req() req: AuthedRequest, @Param('id') taskId: string, @Param('sourceTaskId') sourceTaskId: string, @Body() body: unknown) {
    return this.context.setWeight(req.user!.id, taskId, sourceTaskId, parse(weightBody, body).weight)
  }

  @Delete(':sourceTaskId')
  @HttpCode(204)
  remove(@Req() req: AuthedRequest, @Param('id') taskId: string, @Param('sourceTaskId') sourceTaskId: string) {
    return this.context.remove(req.user!.id, taskId, sourceTaskId)
  }

  @Post(':sourceTaskId/refresh')
  refresh(@Req() req: AuthedRequest, @Param('id') taskId: string, @Param('sourceTaskId') sourceTaskId: string) {
    return this.context.refresh(req.user!.id, taskId, sourceTaskId)
  }

  @Post(':sourceTaskId/summary-draft')
  async draft(@Req() req: AuthedRequest, @Param('id') taskId: string, @Param('sourceTaskId') sourceTaskId: string, @Body() body: unknown) {
    const { messageIds } = parse(draftBody, body)
    const available = (await this.context.candidates(taskId)).some((item) => item.taskId === sourceTaskId)
      || (await this.context.list(taskId)).some((item) => item.input.sourceTaskId === sourceTaskId)
    if (!available) throw new ConflictException({ code: 'TAG_NOT_SHARED' })
    const all = await this.context.preview(sourceTaskId)
    if (messageIds && (new Set(messageIds).size !== messageIds.length || messageIds.some((value) => !all.some((item) => item.id === value)))) {
      throw new BadRequestException({ code: 'INVALID_MESSAGE_IDS' })
    }
    const chosen = messageIds ? all.filter((item) => messageIds.includes(item.id)) : all
    if (!chosen.length) throw new BadRequestException('요약할 메시지가 없습니다')
    return this.requests.draftConversationSummary(req.user!.id, taskId, chosen)
  }
}
