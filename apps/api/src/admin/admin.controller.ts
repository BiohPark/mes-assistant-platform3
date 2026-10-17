import { UrlDomainListSchema } from '@mes/contracts'
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { z } from 'zod'
import { ClassificationsInputSchema } from '@mes/contracts'
import type { AuthedRequest } from '../auth/guards.js'
import { Roles } from '../auth/roles.decorator.js'
import { CONFIG, type AppConfig } from '../config/config.js'
import { resolveDefaultModel } from '../llm/effectiveDefaultModel.js'
import { AdminService, defaultChecklist } from './admin.service.js'
import { DbCatalogReader } from '../catalog/catalog.service.js'

const key = z.string().trim().min(1).max(191)
const label = z.string().trim().min(1).max(1000)
const codeName = z.string().transform(value => value.trim().replace(/\s+/gu, ' ').normalize('NFC')).pipe(z.string().min(1).max(191))
const status = z.enum(['open', 'developing', 'testing', 'retired'])
const template = z.object({ id: key, label, required: z.boolean() }).strict()
const assistantFields = z.object({
  classifications: ClassificationsInputSchema.optional(),
  name: label, level1: codeName.optional(), level2: codeName.optional(), level1CodeId: key.optional(), level2CodeId: key.optional(), summary: z.string(), ownerId: key,
  status, usageExample: z.string(), modelId: z.string().nullable().optional(), link1: z.string().nullable().optional(),
  docUrl: z.string().nullable().optional(), expectedInputs: z.array(label).max(100), expectedOutputs: z.array(label).max(100),
  checklistTemplate: z.array(template).max(100).optional(),
}).strict()
const classificationShape = (input: z.infer<typeof assistantFields>) => !input.classifications ||
  [input.level1, input.level2, input.level1CodeId, input.level2CodeId].every(value => value === undefined)
const createAssistant = assistantFields.extend({ id: key.optional() }).refine(classificationShape).refine((input) =>
  input.classifications !== undefined || ((input.level1 !== undefined || input.level1CodeId !== undefined) && (input.level2 !== undefined || input.level2CodeId !== undefined)))
const patchAssistant = assistantFields.partial().refine(input => !input.classifications ||
  [input.level1, input.level2, input.level1CodeId, input.level2CodeId].every(value => value === undefined))
/** 새 override만 쓰기 허용. 유효 모델·출처 및 알 수 없는 키는 strict로 거부한다. */
const settings = z.object({
  urlAutoFetch: z.boolean().optional(),
  urlAllowDomains: UrlDomainListSchema.optional(),
  urlBlockDomains: UrlDomainListSchema.optional(),
  defaultModelOverride: z.string().trim().max(191).nullable().transform(value => value || null).optional(),
  owuiTools: z.enum(['auto', 'off']).optional(),
  owuiMode: z.enum(['auto', 'session', 'direct']).optional(),
  owuiCleanup: z.boolean().optional(),
  fileDelivery: z.enum(['inline', 'openwebui']).optional(),
  requestBudgetBytes: z.number().int().min(1024).max(100_000_000).optional(),
  /** OpenWebUI 주소 — 자리표시자({modelId}·{assistantId})는 선택. 없으면 웹이 ?model=ID를 붙인다(lib/links.ts) */
  srIntakeAssistantId: key.nullable().optional(), link1Rule: z.string().trim().max(4000).refine((value) => {
    if (!value) return true
    try { const url = new URL(value.replaceAll('{modelId}', 'model').replaceAll('{assistantId}', 'assistant')); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password }
    catch { return false }
  }).optional(),
  fileMaxPerRequest: z.number().int().min(1).max(100).optional(),
}).strict()
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new BadRequestException('요청 형식이 올바르지 않습니다')
  return result.data
}

@Controller('assistants')
export class AdminAssistantsController {
  constructor(@Inject(AdminService) private readonly admin: AdminService, @Inject(DbCatalogReader) private readonly catalog: DbCatalogReader) {}
  private async view(id: string) { return (await this.catalog.assistants()).find((row) => row.id === id) }
  @Post()
  @Roles('system_owner')
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parse(createAssistant, body)
    const created = await this.admin.createAssistant(req.user!.id, { ...input, checklistTemplate: input.checklistTemplate ?? defaultChecklist() })
    return this.view(created.id)
  }
  @Put('order')
  @Roles('system_owner')
  @HttpCode(204)
  order(@Body() body: unknown) {
    const input = parse(z.object({ ids: z.array(key), revisions: z.record(key, z.number().int().nonnegative()) }).strict(), body)
    return this.admin.order(input.ids, input.revisions)
  }
  @Patch(':id')
  @Roles('system_owner')
  async update(@Param('id') id: string, @Body() body: unknown) { await this.admin.updateAssistant(id, parse(patchAssistant, body)); return this.view(id) }
  @Delete(':id')
  @Roles('system_owner')
  @HttpCode(204)
  remove(@Param('id') id: string) { return this.admin.deleteAssistant(id) }
  @Post(':id/image')
  @Roles('system_owner')
  @UseInterceptors(FileInterceptor('file'))
  async image(@Req() req: AuthedRequest, @Param('id') id: string, @UploadedFile() file?: { originalname: string; mimetype: string; buffer: Buffer; size: number }) {
    if (!file) throw new BadRequestException('이미지가 필요합니다')
    await this.admin.image(req.user!.id, id, file)
    return this.view(id)
  }
  @Delete(':id/image')
  @Roles('system_owner')
  @HttpCode(204)
  clearImage(@Req() req: AuthedRequest, @Param('id') id: string) { return this.admin.image(req.user!.id, id, null).then(() => undefined) }
}

@Controller('settings')
export class AdminSettingsController {
  constructor(@Inject(AdminService) private readonly admin: AdminService, @Inject(CONFIG) private readonly config: AppConfig) {}
  private view(rows: Record<string, unknown>) {
    const resolved = resolveDefaultModel(this.config, rows.defaultModelOverride)
    return { urlAutoFetch: true, urlAllowDomains: [], urlBlockDomains: [], ...rows, urlAutoFetchAvailable: this.config.urlAutoFetch !== false, defaultModel: resolved.model, defaultModelSource: resolved.source }
  }
  @Get()
  async get() { return this.view(await this.admin.getSettings()) }
  @Patch()
  @Roles('system_owner')
  async patch(@Body() body: unknown) { return this.view(await this.admin.settings(parse(settings, body))) }
  /** 현재 캐릭터 이미지 — 로그인 사용자 누구나(요청자 포함) 이 파일만 열람. 교체되면 파일 ID가 바뀌므로 웹은 ?v=<fileId>로 캐시를 가른다 (U4 리뷰 P2) */
  @Get('assistant-image')
  async assistantImageContent(@Res() res: Response) {
    let content: Awaited<ReturnType<AdminService['assistantImageContent']>>
    try { content = await this.admin.assistantImageContent() }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new NotFoundException('캐릭터 이미지가 없습니다')
      throw error
    }
    res.setHeader('Content-Type', content.mime)
    res.setHeader('Content-Length', content.size)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate')
    content.stream.on('error', (error) => {
      if (!res.headersSent) { res.removeHeader('Content-Length'); res.status(500).end() }
      else res.destroy(error)
    })
    content.stream.pipe(res)
  }
  /** AI 도우미 캐릭터 이미지 업로드·교체 (SO 전용) (U4) */
  @Post('assistant-image')
  @Roles('system_owner')
  @UseInterceptors(FileInterceptor('file'))
  async assistantImage(@Req() req: AuthedRequest, @UploadedFile() file?: { originalname: string; mimetype: string; buffer: Buffer; size: number }) {
    if (!file) throw new BadRequestException('이미지가 필요합니다')
    return this.view(await this.admin.assistantImage(req.user!.id, file))
  }
  @Delete('assistant-image')
  @Roles('system_owner')
  @HttpCode(204)
  clearAssistantImage(@Req() req: AuthedRequest) { return this.admin.assistantImage(req.user!.id, null).then(() => undefined) }
}

@Controller('codes')
export class AdminCodesController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}
  @Post()
  @Roles('system_owner')
  create(@Body() body: unknown) { return this.admin.createCode(parse(z.object({ groupKey: key, code: key, name: label, sortOrder: z.number().int().optional() }).strict(), body)) }
  @Patch(':id')
  @Roles('system_owner')
  patch(@Param('id') id: string, @Body() body: unknown) { return this.admin.updateCode(id, parse(z.object({ name: label.optional(), sortOrder: z.number().int().optional(), active: z.boolean().optional() }).strict(), body)) }
  @Get('manage')
  @Roles('system_owner')
  manage(@Query('group') group?: string) { return this.admin.codes(group, true) }
}
