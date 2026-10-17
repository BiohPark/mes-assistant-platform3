import type { LlmSettings } from '@mes/domain'
import { limitedFetch } from './limitedFetch.js'

export type OwuiTerminalSource = 'model' | 'global' | 'single' | 'none'
export interface OwuiTerminal { id: string; name?: string }
export interface OwuiTerminalFallback { defaultTerminalId?: string | null; terminals?: readonly OwuiTerminal[] }
/** API 어댑터가 호출 시점의 전역 설정을 읽는다. domain 계약을 바꾸지 않는 OWUI 전용 확장. */
export type OwuiSettings = LlmSettings & {
  readOwuiDefaultTerminalId?: () => Promise<string | null>
}

export function validTerminalId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200
    && [...value].every(character => character.charCodeAt(0) >= 0x20 && character.charCodeAt(0) !== 0x7f)
}

/** OWUI routers/terminals.py: 서비스 계정에 허용된 활성 연결만 반환한다. URL·인증 설정은 보관하거나 노출하지 않는다. */
export class OwuiTerminalCatalog {
  private cached?: { baseUrl: string; apiKey: string; expires: number; items: OwuiTerminal[] }

  async list(settings: LlmSettings, signal?: AbortSignal, timeoutMs = 10_000): Promise<OwuiTerminal[]> {
    const baseUrl = settings.baseUrl.replace(/\/+$/, '').replace(/\/api$/, '')
    if (this.cached && this.cached.baseUrl === baseUrl && this.cached.apiKey === settings.apiKey && this.cached.expires > Date.now()) return this.cached.items
    const res = await limitedFetch(`${baseUrl}/api/v1/terminals/`, {
      headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
    }, { timeoutMs: Math.min(10_000, timeoutMs), maxResponseBytes: 1024 * 1024, signal })
    if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw new Error(`HTTP ${res.status}`) }
    let body: unknown
    try { body = await res.json() } catch { throw new Error('응답 형식 오류') }
    if (!Array.isArray(body) || !body.every(item => item && typeof item === 'object' && validTerminalId(item.id))) throw new Error('응답 형식 오류')
    const items = body.map(item => ({ id: item.id as string, ...(typeof item.name === 'string' && item.name.trim() ? { name: item.name.slice(0, 200) } : {}) }))
    this.cached = { baseUrl, apiKey: settings.apiKey, expires: Date.now() + 5 * 60_000, items }
    return items
  }
}
