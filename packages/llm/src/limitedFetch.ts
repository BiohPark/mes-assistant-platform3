export type LimitedFetchCode = 'timeout' | 'redirect' | 'response_too_large' | 'aborted' | 'network'

/** 상위 서비스 본문·주소·키가 섞이지 않는 고정 문구만 쓴다(safeError 허용 문구). */
export const LIMITED_FETCH_MESSAGES: Record<LimitedFetchCode, string> = {
  timeout: '응답 시간 초과',
  redirect: '리다이렉트 응답은 허용하지 않습니다',
  response_too_large: '응답 크기 한도 초과',
  aborted: '요청이 취소되었습니다.',
  network: 'LLM 서비스 연결 오류',
}

export class LimitedFetchError extends Error {
  readonly code: LimitedFetchCode
  /** 연결 수립 실패로 요청 본문이 전송되지 않았음이 확실할 때만 true. */
  readonly requestNotSent: boolean
  constructor(code: LimitedFetchCode, requestNotSent = false) {
    super(LIMITED_FETCH_MESSAGES[code])
    this.name = 'LimitedFetchError'
    this.code = code
    this.requestNotSent = requestNotSent
  }
}

export interface FetchLimits {
  /** 응답 헤더뿐 아니라 본문을 다 읽을 때까지의 총 시간 */
  timeoutMs?: number
  /** 본문 누적 바이트 상한 — 넘으면 절단하지 않고 실패한다 */
  maxResponseBytes?: number
  signal?: AbortSignal
}

export function toLimitedFetchError(error: unknown): LimitedFetchError {
  if (error instanceof LimitedFetchError) return error
  if (error instanceof DOMException && error.name === 'AbortError') return new LimitedFetchError('aborted')
  return new LimitedFetchError('network')
}

/** fetch의 구조화된 원인만 확인한다. 메시지·소켓 끊김·타임아웃은 실행 여부를 증명하지 못한다. */
function isPreConnectionFailure(error: unknown): boolean {
  const codes = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'])
  const seen = new Set<object>()
  while (error !== null && typeof error === 'object' && !seen.has(error)) {
    seen.add(error)
    const cause = error as { code?: unknown; cause?: unknown }
    if (typeof cause.code === 'string') return codes.has(cause.code)
    error = cause.cause
  }
  return false
}

/**
 * ping·listModels·stream 공통 fetch — redirect manual(3xx 차단)·총 시간 제한·응답 바이트 상한.
 * 돌려주는 Response의 본문은 상한 검사를 거친 스트림이며, 실패는 항상 LimitedFetchError로 드러난다.
 */
export async function limitedFetch(url: string, init: RequestInit = {}, limits: FetchLimits = {}): Promise<Response> {
  const controller = new AbortController()
  let reason: LimitedFetchCode | undefined
  const fail = (code: LimitedFetchCode) => { if (!reason) { reason = code; controller.abort(new LimitedFetchError(code)) } }
  const onOuterAbort = () => fail('aborted')
  if (limits.signal?.aborted) fail('aborted')
  else limits.signal?.addEventListener('abort', onOuterAbort, { once: true })
  const timer = limits.timeoutMs ? setTimeout(() => fail('timeout'), limits.timeoutMs) : undefined
  ;(timer as { unref?: () => void } | undefined)?.unref?.()
  const finish = () => { if (timer) clearTimeout(timer); limits.signal?.removeEventListener('abort', onOuterAbort) }
  const mapError = (error: unknown) => reason ? new LimitedFetchError(reason) : toLimitedFetchError(error)

  let response: Response
  try { response = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal }) }
  catch (error) {
    finish()
    const mapped = mapError(error)
    if (mapped.code === 'network' && isPreConnectionFailure(error)) throw new LimitedFetchError('network', true)
    throw mapped
  }
  if (response.status >= 300 && response.status < 400) {
    finish()
    await response.body?.cancel().catch(() => undefined)
    throw new LimitedFetchError('redirect')
  }
  if (!response.body) { finish(); return response }

  const reader = response.body.getReader()
  const max = limits.maxResponseBytes ?? Number.POSITIVE_INFINITY
  let received = 0
  const guarded = new ReadableStream<Uint8Array>({
    async pull(sink) {
      let next: Awaited<ReturnType<typeof reader.read>>
      try { next = await reader.read() }
      catch (error) { finish(); sink.error(mapError(error)); return }
      if (next.done) { finish(); sink.close(); return }
      received += next.value.byteLength
      if (received > max) {
        fail('response_too_large')
        finish()
        await reader.cancel().catch(() => undefined)
        sink.error(new LimitedFetchError('response_too_large'))
        return
      }
      sink.enqueue(next.value)
    },
    async cancel(cancelReason) { finish(); await reader.cancel(cancelReason).catch(() => undefined) },
  })
  return new Response(guarded, { status: response.status, statusText: response.statusText, headers: response.headers })
}
