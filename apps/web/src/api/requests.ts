import { newId } from '@/lib/ids'
import type { RequestInfo } from '@mes/domain'

export type RequestEstimate = RequestInfo & { overLimit: boolean; attachmentLimit: number }
export async function estimateRequest(threadId: string, body: { draft?: string; attachmentIds?: string[]; oneShotFileIds?: string[] }): Promise<RequestEstimate> {
  return check(await fetch(`/api/threads/${encodeURIComponent(threadId)}/requests/estimate`, { method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).then((response) => response.json()) as Promise<RequestEstimate>
}

export interface RequestInputRecord {
  kind: 'file' | 'conversation' | 'sr'
  weight: 'main' | 'reference'
  srId?: string | null
  srCode?: string
  srTitle?: string
  fileId?: string | null
  fileVersion?: number | null
  sourceLabel?: string | null
  oneShot?: boolean
  delivery?: 'attached' | 'inline' | 'metadata_only' | 'failed' | null
  mode?: 'full' | 'messages' | 'summary' | null
  messageCount?: number | null
  bytes: number
  error?: string | null
}
export interface RequestRecord {
  id: string
  threadId: string
  status: string
  code?: string | null
  phase?: string | null
  createdAt?: string
  provider: string
  transport: string
  owuiTools?: RequestInfo['owuiTools'] | null
  model: string
  bytes: number | null
  limitBytes: number
  error?: string | null
  retryOf?: string | null
  hasSnapshot: boolean
  webPages?: RequestInfo['webPages']
  inputs: RequestInputRecord[]
  /** 이 요청의 첫 응답 제한·무응답 제한·최대 처리 시간(ms, 첨부 반영) — 화면의 '제한까지 남은 시간' */
  firstTokenMs?: number
  idleMs?: number
  maxMs?: number
}
/** 서버 요청의 끝 상태 — 이 상태면 더 기다리지 않는다 */
export const isTerminalRequest = (status?: string) => status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'interrupted'

async function check(response: Response) {
  if (response.ok) return response
  const body = await response.json().catch(() => ({})) as { message?: string | { code?: string } }
  throw new Error(typeof body.message === 'string' ? body.message : body.message?.code ?? `HTTP ${response.status}`)
}

export async function readSse(reader: ReadableStreamDefaultReader<Uint8Array>, onEvent: (event: string, data: Record<string, unknown>) => void) {
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer = (buffer + decoder.decode(value, { stream: true })).replaceAll('\r\n', '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const event = frame.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim()
      const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (event && data) onEvent(event, JSON.parse(data) as Record<string, unknown>)
      boundary = buffer.indexOf('\n\n')
    }
  }
}

export async function streamRequest(path: string, body: unknown, onEvent: (event: string, data: Record<string, unknown>) => void, key: string = newId(), signal?: AbortSignal) {
  const response = await check(await fetch(`/api${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body), signal }))
  if (!response.body) throw new Error('스트림 응답이 없습니다')
  const reader = response.body.getReader()
  // 중단하면 읽기를 끝낸다 — 응답 본문을 이미 받은 뒤에도 바로 멈추게(fetch 구현과 무관하게)
  const stop = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', stop, { once: true })
  try { await readSse(reader, onEvent) } finally { signal?.removeEventListener('abort', stop) }
}

export async function getRequest(id: string): Promise<RequestRecord> {
  return check(await fetch(`/api/requests/${encodeURIComponent(id)}`, { credentials: 'same-origin' })).then((response) => response.json()) as Promise<RequestRecord>
}
export async function cancelRequest(id: string) {
  await check(await fetch(`/api/requests/${encodeURIComponent(id)}/cancel`, { method: 'POST', credentials: 'same-origin' }))
}
export const snapshotUrl = (id: string) => `/api/requests/${encodeURIComponent(id)}/snapshot`
