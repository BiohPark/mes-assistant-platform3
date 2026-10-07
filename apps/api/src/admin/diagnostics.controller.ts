import { Controller, Get, Inject } from '@nestjs/common'
import { Roles } from '../auth/roles.decorator.js'
import { DiagnosticsService } from './diagnostics.service.js'

@Controller('admin/diagnostics')
export class DiagnosticsController {
  constructor(@Inject(DiagnosticsService) private readonly diagnostics: DiagnosticsService) {}

  @Get()
  @Roles('system_owner')
  get() { return this.diagnostics.get() }
}
