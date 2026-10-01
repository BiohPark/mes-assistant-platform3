import { BadGatewayException, BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Inject, Post } from '@nestjs/common'
import { SYSTEM_ASSISTANT_PROMPT, SYSTEM_TOOLS, type ChatMessageInput, type ChatProvider, type ToolCall } from '@mes/llm'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { CONFIG, type AppConfig } from '../config/config.js'
import { DB, type Db } from '../db/db.module.js'
import { appSetting } from '../db/schema.js'
import { LLM_PROVIDER } from './provider.token.js'
import { toLlmSettings } from './presets.js'

const bodySchema = z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) }).strict()).min(1) }).strict()

@Controller('system-assistant')
export class SystemAssistantController {
  constructor(@Inject(LLM_PROVIDER) private readonly provider: ChatProvider, @Inject(CONFIG) private readonly config: AppConfig, @Inject(DB) private readonly db: Db) {}

  @Get('model')
  async model() {
    const [setting] = await this.db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'defaultModel'))
    return { mode: this.config.llm.mode, model: typeof setting?.value === 'string' && setting.value ? setting.value : toLlmSettings(this.config.llm).model }
  }

  @Post('messages')
  async messages(@Body() body: unknown): Promise<{ text: string; toolCalls: ToolCall[] }> {
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success || parsed.data.messages.at(-1)?.role !== 'user') throw new BadRequestException('요청 형식이 올바르지 않습니다')
    const [budgetSetting] = await this.db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'requestBudgetBytes'))
    const [modelSetting] = await this.db.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'defaultModel'))
    const model = typeof modelSetting?.value === 'string' && modelSetting.value ? modelSetting.value : toLlmSettings(this.config.llm).model
    const messages: ChatMessageInput[] = [{ role: 'system', content: SYSTEM_ASSISTANT_PROMPT }, ...parsed.data.messages]
    const limit = typeof budgetSetting?.value === 'number' ? budgetSetting.value : this.config.request.budgetBytes
    if (Buffer.byteLength(JSON.stringify({ model, messages, tools: SYSTEM_TOOLS, stream: true })) > limit) throw new HttpException('요청 크기 한도 초과', HttpStatus.PAYLOAD_TOO_LARGE)
    let text = ''
    const toolCalls: ToolCall[] = []
    try {
      for await (const chunk of this.provider.stream({ model, messages, tools: SYSTEM_TOOLS, meta: { systemAssistant: true } })) {
        if (chunk.type === 'delta') text += chunk.text
        else if (chunk.type === 'tool_call') toolCalls.push(chunk.call)
        else if (chunk.type === 'error') throw new Error(chunk.message)
      }
    } catch {
      throw new BadGatewayException('시스템 assistant 응답 실패')
    }
    return { text, toolCalls }
  }
}
