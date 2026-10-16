import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { parseDocument, DomUtils } from 'htmlparser2'
import type { WebPageRead } from '@mes/domain'

export interface UrlPolicy {
  enabled: boolean
  allowDomains: string[]
  blockDomains: string[]
  selfOrigins: string[]
  selfAddresses: string[]
  apiPort: number
}
type Address = { address: string; family: number }
interface Options { scope?: string; signal?: AbortSignal; onProgress?: (host: string) => void }
interface Dependencies {
  resolve?: (host: string) => Promise<Address[]>
  open?: (url: URL, address: Address, signal: AbortSignal) => Promise<Response>
  now?: () => number
}
const MAX_BYTES = 2 * 1024 * 1024
const canonicalAddress = (address: string): string => {
  const ip = hostName(address)
  if (isIP(ip) !== 6) return ip
  const normalized = new URL(`http://[${ip}]`).hostname.slice(1, -1)
  if (!normalized.startsWith('::ffff:')) return normalized
  const parts = normalized.slice(7).split(':')
  const value = (parseInt(parts[0]!, 16) * 65536 + parseInt(parts[1]!, 16)) >>> 0
  return [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255].join('.')
}
const hostName = (host: string) => host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')

export function extractUrls(text: string): string[] {
  const urls = new Set<string>()
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\u3002\uff0c\uff09]+/gi)) {
    let raw = match[0].replace(/[.,;:!?\]}>]+$/, '')
    while (raw.endsWith(')') && (raw.match(/\)/g)?.length ?? 0) > (raw.match(/\(/g)?.length ?? 0)) raw = raw.slice(0, -1)
    try { const url = new URL(raw); url.hash = ''; urls.add(url.href) } catch { /* malformed link */ }
    if (urls.size === 3) break
  }
  return [...urls]
}

/** IPv6 is expanded through URL canonicalization, including dotted IPv4 mapped literals. */
export function blockedAddress(address: string): boolean {
  const ip = hostName(address)
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 127 || a === 169 && b === 254 || a! >= 224 || ['100.100.100.200', '168.63.129.16', '192.0.0.192'].includes(ip)
  }
  if (isIP(ip) !== 6) return true
  const normalized = new URL(`http://[${ip}]`).hostname.slice(1, -1)
  if (normalized.startsWith('::ffff:')) {
    const parts = normalized.slice(7).split(':')
    const value = (parseInt(parts[0]!, 16) * 65536 + parseInt(parts[1]!, 16)) >>> 0
    return blockedAddress([value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255].join('.'))
  }
  // Unspecified, loopback, IPv4-compatible, link-local, multicast, metadata and translation tunnels.
  return normalized === '::' || normalized === '::1' || normalized.startsWith('::')
    || /^(?:fe[89ab]|ff)/i.test(normalized) || normalized === 'fd00:ec2::254'
    || /^(?:64:ff9b:|2002:|2001:(?:0:|:))/i.test(normalized)
}

/** Pin the verified DNS result in the actual socket lookup; preserve Host and TLS SNI. No ambient cookies, proxy, or credentials. */
async function openPinned(url: URL, address: Address, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      signal, agent: false, headers: { accept: 'text/html, text/plain, application/json', 'accept-encoding': 'identity' },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address: address.address, family: address.family }])
        else callback(null, address.address, address.family)
      },
    }, incoming => {
      const headers = new Headers()
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      const status = incoming.statusCode ?? 500
      if ([204, 205, 304].includes(status)) { incoming.resume(); resolve(new Response(null, { status, headers })); return }
      resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status, headers }))
    })
    request.on('error', reject)
    request.end()
  })
}

function htmlText(html: string): { title?: string; text: string } {
  const doc = parseDocument(html)
  const titleNode = DomUtils.findOne(node => node.name === 'title', doc.children, true)
  const title = titleNode ? DomUtils.textContent(titleNode).trim() : undefined
  if (titleNode) DomUtils.removeElement(titleNode)
  for (const node of DomUtils.findAll(node => ['script', 'style', 'noscript', 'nav', 'footer', 'header', 'template'].includes(node.name) || 'hidden' in node.attribs || node.attribs['aria-hidden'] === 'true', doc.children)) DomUtils.removeElement(node)
  const body = DomUtils.findOne(node => ['main', 'article'].includes(node.name), doc.children, true)
    ?? DomUtils.findOne(node => node.name === 'body', doc.children, true) ?? doc
  // Add boundaries before flattening to avoid merging neighboring paragraphs.
  const render = (node: typeof doc.children[number]): string => {
    if (node.type === 'text') return node.data
    if ('children' in node) return `${'name' in node && /^(p|div|section|article|main|h[1-6]|li|tr|br)$/.test(node.name) ? '\n' : ''}${node.children.map(render).join('')}`
    return ''
  }
  const text = render(body).replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { title, text: [title, text].filter(Boolean).join('\n') }
}

export class UrlReader {
  private readonly cache = new Map<string, { until: number; pages: WebPageRead[]; size: number }>()
  private cacheBytes = 0
  private readonly pending = new Map<string, Promise<WebPageRead[]>>()
  private readonly resolve: NonNullable<Dependencies['resolve']>
  private readonly open: NonNullable<Dependencies['open']>
  private readonly now: () => number
  constructor(deps: Dependencies = {}) {
    this.resolve = deps.resolve ?? (host => lookup(host, { all: true, verbatim: true }))
    this.open = deps.open ?? openPinned
    this.now = deps.now ?? Date.now
  }
  async read(text: string, policy: UrlPolicy, opts: Options = {}): Promise<WebPageRead[]> {
    if (!policy.enabled) return []
    const urls = extractUrls(text)
    if (!urls.length) return []
    const key = createHash('sha256').update(JSON.stringify([opts.scope, policy, urls])).digest('hex')
    for (const [key, entry] of this.cache) if (entry.until <= this.now()) { this.cache.delete(key); this.cacheBytes -= entry.size }
    const hit = this.cache.get(key)
    if (hit && !opts.signal?.aborted) {
      for (const url of urls) opts.onProgress?.(new URL(url).host)
      return structuredClone(hit.pages)
    }
    const active = this.pending.get(key)
    if (active && !opts.signal?.aborted) {
      for (const url of urls) opts.onProgress?.(new URL(url).host)
      return structuredClone(await active)
    }
    const pending = this.readAndCache(key, urls, policy, opts)
    this.pending.set(key, pending)
    try { return await pending }
    finally { if (this.pending.get(key) === pending) this.pending.delete(key) }
  }
  private async readAndCache(key: string, urls: string[], policy: UrlPolicy, opts: Options): Promise<WebPageRead[]> {
    const pages: WebPageRead[] = []
    for (const url of urls) {
      opts.onProgress?.(new URL(url).host)
      pages.push(await this.readOne(url, policy, opts.signal))
    }
    if (!opts.signal?.aborted) {
      const size = pages.reduce((total, page) => total + Buffer.byteLength(page.text) + Buffer.byteLength(page.url) + 512, 0)
      while (this.cache.size >= 100 || this.cacheBytes + size > 32 * 1024 * 1024) {
        const oldest = this.cache.keys().next().value
        if (!oldest) break
        this.cacheBytes -= this.cache.get(oldest)!.size; this.cache.delete(oldest)
      }
      const previous = this.cache.get(key)
      if (previous) this.cacheBytes -= previous.size
      this.cache.set(key, { until: this.now() + 300_000, pages: structuredClone(pages), size }); this.cacheBytes += size
    }
    return pages
  }
  private async readOne(original: string, policy: UrlPolicy, outer?: AbortSignal): Promise<WebPageRead> {
    const controller = new AbortController()
    const cancel = () => controller.abort(new Error('요청 취소'))
    if (outer?.aborted) cancel()
    else outer?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => controller.abort(new Error('응답 시간 초과')), 15_000)
    const signal = controller.signal
    // DNS and injected transports must also obey the total deadline.
    let stop!: () => void
    const aborted = new Promise<never>((_, reject) => {
      stop = () => reject(signal.reason)
      if (signal.aborted) stop()
      else signal.addEventListener('abort', stop, { once: true })
    })
    void aborted.catch(() => undefined)
    const wait = <T>(promise: Promise<T>) => Promise.race([promise, aborted])
    let bytes = 0, url = new URL(original)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      for (let redirects = 0; ; redirects++) {
        signal.throwIfAborted()
        const host = hostName(url.hostname)
        const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('허용하지 않는 URL')
        if (policy.blockDomains.some(matches) || policy.allowDomains.length && !policy.allowDomains.some(matches)) throw new Error('도메인 정책 차단')
        if (['localhost', 'metadata.google.internal', 'metadata.goog', 'instance-data.ec2.internal'].some(matches)) throw new Error('차단된 주소')
        if (policy.selfOrigins.some(origin => new URL(origin).origin === url.origin)) throw new Error('API 자신은 읽을 수 없음')
        const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await wait(this.resolve(host))
        if (!addresses.length || addresses.some(item => blockedAddress(item.address))) throw new Error('차단된 주소')
        if (Number(url.port || (url.protocol === 'https:' ? 443 : 80)) === policy.apiPort && addresses.some(item => policy.selfAddresses.some(own => canonicalAddress(own) === canonicalAddress(item.address)))) throw new Error('API 자신은 읽을 수 없음')
        const response = await wait(this.open(url, addresses[0]!, signal))
        reader = response.body?.getReader()
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          void reader?.cancel().catch(() => undefined); reader = undefined
          if (redirects >= 5) throw new Error('리다이렉트 한도 초과')
          const location = response.headers.get('location')
          if (!location) throw new Error('리다이렉트 주소 없음')
          url = new URL(location, url); continue
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
        if (!(mime.startsWith('text/') || mime === 'application/json' || mime.endsWith('+json') || mime === 'application/xhtml+xml')) throw new Error('지원하지 않는 콘텐츠 형식')
        if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('응답 크기 2MB 한도 초과')
        const chunks: Uint8Array[] = []
        while (reader) {
          const part = await wait(reader.read())
          if (part.done) break
          bytes += part.value.byteLength
          if (bytes > MAX_BYTES) throw new Error('응답 크기 2MB 한도 초과')
          chunks.push(part.value)
        }
        const charset = /charset=["']?([^;\s"']+)/i.exec(response.headers.get('content-type') ?? '')?.[1] ?? 'utf-8'
        const raw = new TextDecoder(charset).decode(Buffer.concat(chunks))
        return { url: original, finalUrl: url.href, bytes, status: 'read', ...(mime === 'text/html' || mime === 'application/xhtml+xml' ? htmlText(raw) : { text: raw }) }
      }
    } catch (error) {
      const known = /^(요청 취소|응답 시간 초과|차단된 주소|API 자신은 읽을 수 없음|허용하지 않는 URL|도메인 정책 차단|리다이렉트 한도 초과|리다이렉트 주소 없음|HTTP \d{3}|지원하지 않는 콘텐츠 형식|응답 크기 2MB 한도 초과)$/
      const message = signal.aborted ? (signal.reason as Error).message : error instanceof Error && known.test(error.message) ? error.message : '페이지 연결 또는 해석 실패'
      return { url: original, finalUrl: url.href, bytes, status: 'failed', error: message, text: '' }
    } finally {
      clearTimeout(timer); outer?.removeEventListener('abort', cancel); signal.removeEventListener('abort', stop)
      controller.abort(); void reader?.cancel().catch(() => undefined)
    }
  }
}
