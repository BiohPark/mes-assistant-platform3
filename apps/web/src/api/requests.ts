export interface RequestInputRecord {
  kind: 'file' | 'conversation'
  weight: 'main' | 'reference'
  fileId?: string | null
  fileVersion?: number | null
  sourceLabel?: string | null
  oneShot?: boolean
  delivery?: 'attached' | 'inline' | 'metadata_only' | 'failed' | null
  bytes: number
  error?: string | null
}
export interface RequestRecord {
  id: string
  threadId: string
  status: string
  code?: string | null
  phase?: string | null
  provider: string
  transport: string
  model: string
  bytes: number | null
  limitBytes: number
  error?: string | null
  retryOf?: string | null
  inputs: RequestInputRecord[]
}

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

export async function streamRequest(path: string, body: unknown, onEvent: (event: string, data: Record<string, unknown>) => void, key: string = crypto.randomUUID()) {
  const response = await check(await fetch(`/api${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) }))
  if (!response.body) throw new Error('스트림 응답이 없습니다')
  await readSse(response.body.getReader(), onEvent)
}

export async function getRequest(id: string): Promise<RequestRecord> {
  return check(await fetch(`/api/requests/${encodeURIComponent(id)}`, { credentials: 'same-origin' })).then((response) => response.json()) as Promise<RequestRecord>
}
export async function cancelRequest(id: string) {
  await check(await fetch(`/api/requests/${encodeURIComponent(id)}/cancel`, { method: 'POST', credentials: 'same-origin' }))
}
export const snapshotUrl = (id: string) => `/api/requests/${encodeURIComponent(id)}/snapshot`
