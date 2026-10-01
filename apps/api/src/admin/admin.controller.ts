import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { z } from 'zod'
import type { AuthedRequest } from '../auth/guards.js'
import { Roles } from '../auth/roles.decorator.js'
import { AdminService, defaultChecklist } from './admin.service.js'
import { DbCatalogReader } from '../catalog/catalog.service.js'

const key = z.string().trim().min(1).max(191)
const label = z.string().trim().min(1).max(1000)
const status = z.enum(['open', 'developing', 'testing', 'retired'])
const template = z.object({ id: key, label, required: z.boolean() }).strict()
const assistantFields = z.object({
  name: label, level1CodeId: key, level2CodeId: key, summary: z.string(), ownerId: key,
  status, usageExample: z.string(), modelId: z.string().nullable().optional(), link1: z.string().nullable().optional(),
  docUrl: z.string().nullable().optional(), expectedInputs: z.array(label).max(100), expectedOutputs: z.array(label).max(100),
  checklistTemplate: z.array(template).max(100).optional(),
}).strict()
const createAssistant = assistantFields.extend({ id: key })
const patchAssistant = assistantFields.partial()
const settings = z.object({
  defaultModel: label.optional(), fileDelivery: z.enum(['inline', 'openwebui']).optional(),
  requestBudgetBytes: z.number().int().min(1024).max(100_000_000).optional(),
  srIntakeAssistantId: key.nullable().optional(), link1Rule: z.string().max(4000).refine((value) => {
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
    await this.admin.createAssistant(req.user!.id, { ...input, checklistTemplate: input.checklistTemplate ?? defaultChecklist() })
    return this.view(input.id)
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
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}
  @Get()
  get() { return this.admin.getSettings() }
  @Patch()
  @Roles('system_owner')
  patch(@Body() body: unknown) { return this.admin.settings(parse(settings, body)) }
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
