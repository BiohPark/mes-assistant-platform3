import type { LlmSettings } from '@mes/domain'
import { limitedFetch, toLimitedFetchError } from './limitedFetch.js'

export interface ResponseImage {
  /** 같은 원격 파일을 가리키는 본문의 상대·절대 주소 */
  sources: string[]
  name: string
  mime: string
  bytes: Uint8Array
}
export interface ResponseImageFailure { source: string; reason: string }
export interface ResponseImages { images: ResponseImage[]; failures: ResponseImageFailure[] }

interface Destination { start: number; end: number; url: string; prefix?: string; suffix?: string }
/** 원본 인덱스를 유지해 코드 예제는 수집·치환하지 않는다. */
function destinations(content: string): Destination[] {
  const masked = content.replace(/(^|\n)( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2\3[^\n]*(?=\n|$)|$)|(`+)[^`]*?\4/g, match => ' '.repeat(match.length))
  const found: Destination[] = []
  const inline = /!\[(?:\\.|[^\]\\])*\]\(\s*/g
  for (const match of masked.matchAll(inline)) {
    let start = match.index + match[0].length, end = start
    if (masked[start] === '<') {
      start++; end = masked.indexOf('>', start)
      if (end < 0) continue
    } else {
      let depth = 0
      for (; end < masked.length; end++) {
        const char = masked[end]
        if (char === '\\') { end++; continue }
        if (char === '(') depth++
        if (char === ')') { if (!depth) break; depth-- }
        if (/\s/.test(char!) && !depth) break
      }
    }
    if (end > start) found.push({ start, end, url: content.slice(start, end).replace(/\\([()\\])/g, '$1') })
  }
  // 참조 정의를 바꾸면 같은 정의를 쓰는 일반 링크까지 바뀐다. 이미지 사용 위치만 인라인으로 바꾼다.
  const normalize = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()
  const definitions = new Map<string, { url: string; title: string }>()
  for (const m of masked.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))([^\n]*)/gm)) {
    const label = normalize(m[1]!)
    if (!definitions.has(label)) definitions.set(label, { url: m[2] ?? m[3]!, title: m[4]! })
  }
  for (const m of masked.matchAll(/!\[((?:\\.|[^\]\\])*)\](?:\[([^\]]*)\])?(?!\()/g)) {
    const definition = definitions.get(normalize(m[2] || m[1]!))
    if (definition) found.push({ start: m.index, end: m.index + m[0].length, url: definition.url,
      prefix: `![${m[1]}](`, suffix: `${definition.title})` })
  }
  return found
}

export function responseImageUrls(content: string): string[] { return [...new Set(destinations(content).map(item => item.url))] }

/** 이미지 목적지만 치환한다. 같은 URL의 링크·일반 텍스트·코드와 AI 전송 원문은 건드리지 않는다. */
export function rewriteResponseImageUrls(content: string, replacements: ReadonlyMap<string, string>): string {
  let result = content
  for (const item of destinations(content).sort((a, b) => b.start - a.start)) {
    const url = replacements.get(item.url)
    if (url) result = result.slice(0, item.start) + (item.prefix ?? '') + url + (item.suffix ?? '') + result.slice(item.end)
  }
  return result
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function fileUrls(message?: Record<string, unknown>): string[] {
  if (!message) return []
  const output = Array.isArray(message.output) ? message.output.filter(object) : []
  return [message, ...output.filter(item => item.type === 'message')].flatMap(item => Array.isArray(item.files) ? item.files : []).flatMap(file => {
    if (!object(file) || !(file.type === 'image' || (typeof file.content_type === 'string' && file.content_type.startsWith('image/')))) return []
    if (typeof file.url === 'string') return [file.url]
    return typeof file.id === 'string' ? [`/api/v1/files/${encodeURIComponent(file.id)}/content`] : []
  })
}

/** data URI의 %89 같은 바이트는 UTF-8 문자열로 디코딩하면 손상된다. */
function percentDecodeBytes(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value), decoded = new Uint8Array(encoded.length)
  let length = 0
  for (let i = 0; i < encoded.length; i++) {
    const hex = String.fromCharCode(encoded[i + 1] ?? 0, encoded[i + 2] ?? 0)
    if (encoded[i] === 37 && /^[a-f0-9]{2}$/i.test(hex)) { decoded[length++] = Number.parseInt(hex, 16); i += 2 }
    else decoded[length++] = encoded[i]!
  }
  return decoded.slice(0, length)
}

const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif' }
/** 서비스 계정의 OWUI origin만 인증 다운로드한다. 리다이렉트·비이미지·상한 초과는 절단 없이 실패한다. */
export async function collectResponseImages(settings: LlmSettings, content: string, message?: Record<string, unknown>, signal?: AbortSignal): Promise<ResponseImages> {
  const base = new URL(settings.baseUrl.replace(/\/+$/, '').replace(/\/api$/, '') + '/')
  const candidates = new Map<string, string[]>()
  for (const source of [...responseImageUrls(content), ...fileUrls(message)]) {
    let url: URL
    try { url = new URL(source, base) } catch { continue }
    if (!source.startsWith('data:image') && !(settings.preset === 'openwebui' && url.origin === base.origin && /^https?:$/.test(url.protocol))) continue
    const sources = candidates.get(url.href) ?? []
    if (!sources.includes(source)) sources.push(source)
    candidates.set(url.href, sources)
  }
  const result: ResponseImages = { images: [], failures: [] }
  for (const [url, sources] of candidates) {
    try {
      let bytes: Uint8Array, mime: string
      if (url.startsWith('data:')) {
        const data = /^data:(image\/[a-z0-9.+-]+)((?:;[^,]*)?),([\s\S]*)$/i.exec(url)
        if (!data) throw new Error('이미지 data URI 형식 오류')
        mime = data[1]!.toLowerCase()
        const payload = percentDecodeBytes(data[3]!)
        if (/;base64$/i.test(data[2]!)) {
          const base64 = Buffer.from(payload).toString('latin1').replace(/[\t\n\f\r ]/g, '')
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1 || (base64.includes('=') && base64.length % 4 !== 0)) throw new Error('이미지 base64 형식 오류')
          bytes = Uint8Array.from(Buffer.from(base64, 'base64'))
        } else bytes = payload
        if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('이미지 크기 한도 초과')
      } else {
        const response = await limitedFetch(url, { headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {} }, { timeoutMs: 15_000, maxResponseBytes: 20 * 1024 * 1024, signal })
        if (!response.ok) { await response.body?.cancel(); throw new Error(`이미지 다운로드 실패 (HTTP ${response.status})`) }
        mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
        if (!mime.startsWith('image/')) { await response.body?.cancel(); throw new Error('이미지가 아닌 응답') }
        bytes = new Uint8Array(await response.arrayBuffer())
      }
      if (!bytes.length) throw new Error('빈 이미지 응답')
      result.images.push({ sources, name: `ai-image-${result.images.length + 1}.${extensions[mime] ?? 'img'}`, mime, bytes })
    } catch (error) {
      if (signal?.aborted) throw error
      const reason = error instanceof Error && /^(이미지|빈 이미지)/.test(error.message) ? error.message : toLimitedFetchError(error).message
      result.failures.push({ source: sources[0]!, reason })
    }
  }
  return result
}
