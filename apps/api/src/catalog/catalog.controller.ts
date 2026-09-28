import { Controller, Get, Inject, Query } from '@nestjs/common'
import { AssistantSchema, AssistantStatsSchema, CatalogUserSchema, CodeSchema } from '@mes/contracts'
import { CATALOG, type CatalogReader } from './catalog.service.js'

@Controller()
export class CatalogController {
  constructor(@Inject(CATALOG) private readonly catalog: CatalogReader) {}

  @Get('assistants')
  async assistants() { return AssistantSchema.array().parse(await this.catalog.assistants()) }

  @Get('assistants/stats')
  async stats() { return AssistantStatsSchema.array().parse(await this.catalog.stats()) }

  @Get('users')
  async users() { return CatalogUserSchema.array().parse(await this.catalog.users()) }

  @Get('codes')
  async codes(@Query('group') group?: string) { return CodeSchema.array().parse(await this.catalog.codes(group)) }
}
