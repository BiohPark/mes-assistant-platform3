import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import { OwuiProbeRequestSchema } from '@mes/contracts'
import type { AuthedRequest } from '../auth/guards.js'
import { Roles } from '../auth/roles.decorator.js'
import { DiagnosticsService } from './diagnostics.service.js'

/** 실시간 연결(SSE) 점검 — 이 간격으로 이벤트를 보내고, 화면이 도착 간격으로 프록시 버퍼링을 판단한다 */
export const SSE_PROBE_EVENTS = 3
export const SSE_PROBE_GAP_MS = 500

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

  @Post('openwebui/response-probe')
  @HttpCode(200)
  @Roles('system_owner')
  async responseProbe(@Body() body: unknown, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const parsed = OwuiProbeRequestSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('요청 형식이 올바르지 않습니다')
    const client = new AbortController()
    const onClose = () => { if (!res.writableEnded) client.abort() }
    res.on('close', onClose)
    try { return await this.diagnostics.probeOpenWebUiResponse(req.user!.id, parsed.data.model, client.signal) }
    finally { res.off('close', onClose) }
  }

  /** 실시간 연결(SSE) 점검 — 0·0.5·1초에 ping 3개(보낸 시각 포함)를 보내고 끝낸다. 답 스트림·이벤트와 같은 머리글 */
  @Get('sse')
  @Roles('system_owner')
  sse(@Res() res: Response) {
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.flushHeaders()
    const started = Date.now()
    let seq = 0
    const send = () => { if (!res.writableEnded && !res.destroyed) res.write(`event: ping\ndata: ${JSON.stringify({ seq: seq++, sentAt: Date.now() - started })}\n\n`) }
    send()
    const timer = setInterval(() => {
      send()
      if (seq >= SSE_PROBE_EVENTS) { clearInterval(timer); res.end() }
    }, SSE_PROBE_GAP_MS)
    res.on('close', () => clearInterval(timer))
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
