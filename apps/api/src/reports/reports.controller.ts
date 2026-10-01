import { BadRequestException, Controller, Get, Inject, Query, Req } from '@nestjs/common'
import type { Granularity } from '@mes/domain'
import type { AuthedRequest } from '../auth/guards.js'
import { ReportsService } from './reports.service.js'

@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}
  @Get()
  get(@Req() req: AuthedRequest, @Query('days') rawDays?: string, @Query('granularity') rawGranularity?: string, @Query('userId') userId?: string) {
    const days = rawDays === undefined ? 30 : Number(rawDays)
    const granularity = rawGranularity ?? 'day'
    if (!Number.isInteger(days) || days < 1 || days > 365 || !['day', 'week'].includes(granularity)) throw new BadRequestException('리포트 기간 또는 단위가 올바르지 않습니다')
    return this.reports.get(days, granularity as Granularity, req.user!.id, userId)
  }
}
