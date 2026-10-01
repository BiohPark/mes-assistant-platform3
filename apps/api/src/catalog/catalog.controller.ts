import { Controller, ForbiddenException, Get, Inject, Query, Req } from '@nestjs/common'
import { AssistantSchema, AssistantStatsSchema, CatalogUserSchema, CodeSchema } from '@mes/contracts'
import { CATALOG, type CatalogReader } from './catalog.service.js'
import type { AuthedRequest } from '../auth/guards.js'

@Controller()
export class CatalogController {
  constructor(@Inject(CATALOG) private readonly catalog: CatalogReader) {}

  @Get('assistants')
  async assistants() { return AssistantSchema.array().parse(await this.catalog.assistants()) }

  @Get('assistants/stats')
  async stats() { return AssistantStatsSchema.array().parse(await this.catalog.stats()) }

  @Get('catalog/users')
  async users() { return CatalogUserSchema.array().parse(await this.catalog.users()) }

  @Get('codes')
  async codes(@Req() req: AuthedRequest, @Query('group') group?: string, @Query('includeInactive') includeInactive?: string) {
    if (includeInactive && includeInactive !== 'true' && includeInactive !== 'false') throw new ForbiddenException('잘못된 조회 옵션입니다')
    if (includeInactive === 'true' && !req.user!.isSystemOwner) throw new ForbiddenException('권한이 없습니다')
    return CodeSchema.array().parse(await this.catalog.codes(group, includeInactive === 'true'))
  }
}
