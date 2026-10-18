import type { LlmSettings } from '@mes/domain'
import { limitedFetch, toLimitedFetchError } from './limitedFetch.js'
import { characterEntities } from './markdownEntities.js'

/** CommonMark string decoding, matching the renderer's micromark decodeString rules. */
function decodeDestination(value: string): string {
  return value.replace(/\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi, (match, escaped: string | undefined, reference: string) => {
    if (escaped) return escaped
    if (!reference.startsWith('#')) return Object.hasOwn(characterEntities, reference) ? characterEntities[reference]! : match
    const hex = /^#x/i.test(reference)
    const code = Number.parseInt(reference.slice(hex ? 2 : 1), hex ? 16 : 10)
    return code < 9 || code === 11 || (code > 13 && code < 32) || (code > 126 && code < 160)
      || (code > 0xd7ff && code < 0xe000) || (code > 0xfdcf && code < 0xfdf0)
      || (code & 0xffff) === 0xffff || (code & 0xffff) === 0xfffe || code > 0x10ffff
      ? '\uFFFD' : String.fromCodePoint(code)
  })
}

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
    if (end > start) found.push({ start, end, url: decodeDestination(content.slice(start, end)) })
  }
  // 참조 정의를 바꾸면 같은 정의를 쓰는 일반 링크까지 바뀐다. 이미지 사용 위치만 인라인으로 바꾼다.
  const normalize = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()
  const definitions = new Map<string, { url: string; title: string }>()
  for (const m of masked.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))([^\n]*)/gm)) {
    const label = normalize(m[1]!)
    if (!definitions.has(label)) definitions.set(label, { url: decodeDestination(m[2] ?? m[3]!), title: m[4]! })
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
const MAX_IMAGES = 20
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_BYTES = 40 * 1024 * 1024
/** 서비스 계정의 OWUI origin만 인증 다운로드한다. 리다이렉트·비이미지·상한 초과는 절단 없이 실패한다. */
export async function collectResponseImages(settings: LlmSettings, content: string, message?: Record<string, unknown>, signal?: AbortSignal,
  onProgress?: (result: ResponseImages) => void): Promise<ResponseImages> {
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
  const pending = new Map(candidates)
  // Abort listeners run synchronously, before the API's deadline race finalizes its snapshot.
  const interrupted = () => {
    const failures = [...pending.values()].map(sources => ({ source: sources[0]!,
      reason: signal?.reason === 'timeout' ? '이미지 다운로드 시간 초과' : '이미지 다운로드 중지' }))
    pending.clear()
    result.failures.push(...failures)
    if (failures.length) onProgress?.({ images: [], failures })
  }
  signal?.addEventListener('abort', interrupted, { once: true })
  if (signal?.aborted) interrupted()
  if (pending.size) onProgress?.({ images: [], failures: [] })
  let attempted = 0, remaining = MAX_TOTAL_BYTES
  try {
    for (const [url, sources] of candidates) {
      if (!pending.has(url)) continue
      const imageCount = result.images.length, failureCount = result.failures.length
      const limit = Math.min(MAX_IMAGE_BYTES, remaining)
      let received = 0
      try {
        if (attempted++ >= MAX_IMAGES) throw new Error('이미지 개수 한도 초과')
        if (!remaining) throw new Error('이미지 누적 크기 한도 초과')
        let bytes: Uint8Array, mime: string
        if (url.startsWith('data:')) {
          const data = /^data:(image\/[a-z0-9.+-]+)((?:;[^,]*)?),([\s\S]*)$/i.exec(url)
          if (!data) throw new Error('이미지 data URI 형식 오류')
          mime = data[1]!.toLowerCase()
          const sizeError = () => new Error(remaining < MAX_IMAGE_BYTES ? '이미지 누적 크기 한도 초과' : '이미지 크기 한도 초과')
          // Percent encoding expands at most threefold; reject before allocating decoded buffers.
          if (data[3]!.length > (Math.ceil(limit / 3) * 4 + 4) * 3) throw sizeError()
          const payload = percentDecodeBytes(data[3]!)
          if (/;base64$/i.test(data[2]!)) {
            const base64 = Buffer.from(payload).toString('latin1').replace(/[\t\n\f\r ]/g, '')
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1 || (base64.includes('=') && base64.length % 4 !== 0)) throw new Error('이미지 base64 형식 오류')
            if (Buffer.byteLength(base64, 'base64') > limit) throw sizeError()
            bytes = Uint8Array.from(Buffer.from(base64, 'base64'))
          } else bytes = payload
          if (bytes.byteLength > limit) throw sizeError()
        } else {
          const response = await limitedFetch(url, { headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {} }, { timeoutMs: 15_000, maxResponseBytes: limit, signal })
          if (!response.ok) { await response.body?.cancel(); throw new Error(`이미지 다운로드 실패 (HTTP ${response.status})`) }
          mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
          if (!mime.startsWith('image/')) { await response.body?.cancel(); throw new Error('이미지가 아닌 응답') }
          const chunks: Uint8Array[] = []
          const reader = response.body?.getReader()
          try {
            if (reader) for (;;) {
              const next = await reader.read()
              if (next.done) break
              received += next.value.byteLength
              remaining -= next.value.byteLength
              chunks.push(next.value)
            }
          } finally { await reader?.cancel().catch(() => undefined); reader?.releaseLock() }
          bytes = new Uint8Array(received)
          let offset = 0
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
        }
        if (!bytes.length) throw new Error('빈 이미지 응답')
        if (!pending.has(url)) continue
        if (url.startsWith('data:')) remaining -= bytes.byteLength
        result.images.push({ sources, name: `ai-image-${result.images.length + 1}.${extensions[mime] ?? 'img'}`, mime, bytes })
      } catch (error) {
        if (!pending.has(url)) continue
        const oversized = toLimitedFetchError(error).code === 'response_too_large'
        const reason = oversized && limit < MAX_IMAGE_BYTES ? '이미지 누적 크기 한도 초과'
          : error instanceof Error && /^(이미지|빈 이미지)/.test(error.message) ? error.message : toLimitedFetchError(error).message
        // A failed body may already have consumed its full allowance. Do not download it again.
        if (oversized) remaining -= limit - received
        result.failures.push({ source: sources[0]!, reason })
      }
      pending.delete(url)
      onProgress?.({ images: result.images.slice(imageCount), failures: result.failures.slice(failureCount) })
    }
  } finally { signal?.removeEventListener('abort', interrupted) }
  return result
}
