// 가짜 OpenWebUI — 개발·E2E용 대역. OpenAI 호환 최소 엔드포인트만 흉내 낸다(의존성 없음).
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const port = Number(process.env.PORT ?? 8080)
const MODELS = [
  { id: 'fake-general', name: '가짜 범용 에이전트' },
  { id: 'fake-writer', name: '가짜 문서 작성 에이전트' },
]
const uploads = new Map()

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

function lastUserText(messages = []) {
  const m = [...messages].reverse().find((x) => x.role === 'user')
  if (!m) return ''
  return typeof m.content === 'string' ? m.content : m.content.map((p) => p.text ?? '').join('')
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { status: true })
  if (req.method === 'GET' && url.pathname === '/api/models') {
    return json(res, 200, { data: MODELS.map((m) => ({ ...m, object: 'model', owned_by: 'fake' })) })
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/files/') {
    const body = await readBody(req)
    const filename = /filename="([^"]+)"/.exec(body.toString('latin1'))?.[1] ?? 'upload'
    if (filename.startsWith('fail-')) return json(res, 500, { detail: 'Upload failed' })
    const id = randomUUID()
    uploads.set(id, { filename, at: Date.now() })
    return json(res, 200, { id, filename, meta: { size: body.length } })
  }
  const statusMatch = /^\/api\/v1\/files\/([^/]+)\/process\/status$/.exec(url.pathname)
  if (req.method === 'GET' && statusMatch) {
    const upload = uploads.get(statusMatch[1])
    if (!upload) return json(res, 404, { detail: 'Not Found' })
    const wait = upload.filename.startsWith('stuck-') ? Infinity : upload.filename.startsWith('slow-') ? 8000 : 1500
    return json(res, 200, { status: Date.now() - upload.at >= wait ? 'completed' : 'pending' })
  }
  if (req.method === 'POST' && url.pathname === '/api/chat/completions') {
    const payload = JSON.parse((await readBody(req)).toString('utf8') || '{}')
    const text = `[가짜 OpenWebUI · ${payload.model ?? '?'}] 받은 메시지: ${lastUserText(payload.messages)} [files: ${payload.files?.length ?? 0}]`
    const id = `chatcmpl-${randomUUID()}`
    if (!payload.stream) {
      return json(res, 200, { id, object: 'chat.completion', model: payload.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] })
    }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
    for (const piece of text.match(/.{1,8}/gsu) ?? []) {
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: piece } }] })}\n\n`)
    }
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
    res.end('data: [DONE]\n\n')
    return
  }
  json(res, 404, { detail: 'Not Found' })
})

server.listen(port, () => console.log(`fake-openwebui listening on :${port}`))
