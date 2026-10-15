import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import { OwuiProbeRequestSchema } from '@mes/contracts'
import type { AuthedRequest } from '../auth/guards.js'
import { Roles } from '../auth/roles.decorator.js'
import { DiagnosticsService } from './diagnostics.service.js'

@Controller('admin/diagnostics')
export class DiagnosticsController {
  constructor(@Inject(DiagnosticsService) private readonly diagnostics: DiagnosticsService) {}

  @Get()
  @Roles('system_owner')
  get() { return this.diagnostics.get() }

  /** OpenWebUI 진단(S10-5) — 입력은 모델 하나. 클라이언트가 끊으면 시험 호출을 멈추고 슬롯을 돌려준다 */
  @Post('openwebui')
  @HttpCode(200)
  @Roles('system_owner')
  async probe(@Body() body: unknown, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const parsed = OwuiProbeRequestSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('요청 형식이 올바르지 않습니다')
    const client = new AbortController()
    const onClose = () => { if (!res.writableEnded) client.abort() }
    res.on('close', onClose)
    try { return await this.diagnostics.probeOpenWebUi(req.user!.id, parsed.data.model, client.signal) }
    finally { res.off('close', onClose) }
  }

  /** 에이전트 편집의 연결 확인(S13-J) — 모델 호출 없이 도구·스킬 접근·계정 권한·주입 조건만 */
  @Post('openwebui/access')
  @HttpCode(200)
  @Roles('system_owner')
  async access(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const parsed = OwuiProbeRequestSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('요청 형식이 올바르지 않습니다')
    const client = new AbortController()
    const onClose = () => { if (!res.writableEnded) client.abort() }
    res.on('close', onClose)
    try { return await this.diagnostics.checkOpenWebUiAccess(parsed.data.model, client.signal) }
    finally { res.off('close', onClose) }
  }
}
