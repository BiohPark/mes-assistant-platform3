import { BadGatewayException, BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { SYSTEM_ASSISTANT_PROMPT, SYSTEM_TOOLS, type ChatMessageInput, type ChatProvider, type ToolCall } from '@mes/llm'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { CONFIG, type AppConfig } from '../config/config.js'
import { DB, type Db } from '../db/db.module.js'
import { appSetting } from '../db/schema.js'
import { LLM_PROVIDER } from './provider.token.js'
import { toLlmSettings } from './presets.js'

const bodySchema = z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(32_768) }).strict()).min(1).max(40) }).strict()

@Controller('system-assistant')
export class SystemAssistantController {
  constructor(@Inject(LLM_PROVIDER) private readonly provider: ChatProvider, @Inject(CONFIG) private readonly config: AppConfig, @Inject(DB) private readonly db: Db) {}

  @Get('model')
  async model() {
    const [setting] = await this.db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'defaultModel'))
    return { mode: this.config.llm.mode, model: typeof setting?.value === 'string' && setting.value ? setting.value : toLlmSettings(this.config.llm).model }
  }

  @Post('messages')
  async messages(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ text: string; toolCalls: ToolCall[] }> {
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success || parsed.data.messages.at(-1)?.role !== 'user') throw new BadRequestException('요청 형식이 올바르지 않습니다')
    const [budgetSetting] = await this.db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'requestBudgetBytes'))
    const [modelSetting] = await this.db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'defaultModel'))
    const model = typeof modelSetting?.value === 'string' && modelSetting.value ? modelSetting.value : toLlmSettings(this.config.llm).model
    const messages: ChatMessageInput[] = [{ role: 'system', content: SYSTEM_ASSISTANT_PROMPT }, ...parsed.data.messages]
    const limit = typeof budgetSetting?.value === 'number' ? budgetSetting.value : this.config.request.budgetBytes
    if (parsed.data.messages.reduce((bytes, message) => bytes + Buffer.byteLength(message.content), 0) > limit) throw new HttpException('요청 크기 한도 초과', HttpStatus.PAYLOAD_TOO_LARGE)
    if (Buffer.byteLength(JSON.stringify({ model, messages, tools: SYSTEM_TOOLS, stream: true })) > limit) throw new HttpException('요청 크기 한도 초과', HttpStatus.PAYLOAD_TOO_LARGE)
    let text = ''
    const toolCalls: ToolCall[] = []
    const controller = new AbortController()
    const onRequestClose = () => { if (!req.complete) controller.abort() }
    const onResponseClose = () => { if (!res.writableEnded) controller.abort() }
    req.on('close', onRequestClose)
    res.on('close', onResponseClose)
    let timer: ReturnType<typeof setTimeout> | undefined
    const armTimer = (ms: number) => { if (timer) clearTimeout(timer); timer = setTimeout(() => controller.abort(), ms) }
    armTimer(this.config.request.firstTokenMs ?? 60_000)
    try {
      for await (const chunk of this.provider.stream({ model, messages, tools: SYSTEM_TOOLS, signal: controller.signal, meta: { systemAssistant: true } })) {
        if (controller.signal.aborted) throw new Error('응답 중단')
        armTimer(this.config.request.idleMs ?? 60_000)
        if (chunk.type === 'delta') text += chunk.text
        else if (chunk.type === 'tool_call') toolCalls.push(chunk.call)
        else if (chunk.type === 'error') throw new Error(chunk.message)
      }
      if (controller.signal.aborted) throw new Error('응답 중단')
    } catch {
      throw new BadGatewayException('시스템 assistant 응답 실패')
    } finally {
      if (timer) clearTimeout(timer)
      req.off('close', onRequestClose)
      res.off('close', onResponseClose)
    }
    return { text, toolCalls }
  }
}
