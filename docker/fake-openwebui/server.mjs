// 가짜 OpenWebUI — 개발·E2E용 대역. OpenAI 호환 최소 엔드포인트만 흉내 낸다(의존성 없음).
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const port = Number(process.env.PORT ?? 8080)
// fake-general은 OpenWebUI의 모델 편집 기록(info.meta·info.params)을 흉내 낸다 — OpenWebUI 진단(S10-5)용
const MODELS = [
  { id: 'fake-general', name: '가짜 범용 에이전트', info: {
    meta: { toolIds: ['fake_tool'], defaultFeatureIds: ['web_search'], capabilities: { vision: false, file_upload: true, citations: true }, knowledge: [{ id: 'fake-kb', name: '가짜 지식' }] },
    params: { function_calling: 'native' } } },
  { id: 'fake-writer', name: '가짜 문서 작성 에이전트' },
]
const rejectToolIds = process.env.FAKE_OWUI_REJECT_TOOL_IDS === '1'
const uploads = new Map()
const requests = []
const captureRequests = process.env.FAKE_OWUI_E2E === '1'

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
  if (captureRequests && req.method === 'GET' && url.pathname === '/__e2e/requests') return json(res, 200, requests)
  if (req.method === 'GET' && url.pathname === '/api/version') return json(res, 200, { version: '0.0.0-fake' })
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
    if (captureRequests) {
      requests.push(payload)
      if (requests.length > 200) requests.shift()
    }
    if (rejectToolIds && 'tool_ids' in payload) return json(res, 400, { detail: 'tool_ids is not allowed (fake reject mode)' })
    const text = `[가짜 OpenWebUI · ${payload.model ?? '?'}] 받은 메시지: ${lastUserText(payload.messages)} [files: ${payload.files?.length ?? 0}]`
    const id = `chatcmpl-${randomUUID()}`
    if (!payload.stream) {
      return json(res, 200, { id, object: 'chat.completion', model: payload.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] })
    }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
    // legacy 도구 호출은 OpenWebUI처럼 sources 프레임을 먼저 보낸다
    if (payload.params?.function_calling === 'legacy' && payload.tool_ids?.length) res.write(`data: ${JSON.stringify({ sources: [{ source: { id: 'fake-kb' } }] })}\n\n`)
    if (/\[reasoning\]/i.test(lastUserText(payload.messages))) {
      for (const thought of ['PRIVATE_REASONING: 요청을 검토합니다. ', '자료를 비교합니다. ', '답변을 준비합니다.']) {
        if (res.destroyed) return
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { reasoning_content: thought } }] })}\n\n`)
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      if (res.destroyed) return
    }
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
