// 가짜 OpenWebUI — 개발·E2E용 대역. OpenAI 호환 최소 엔드포인트만 흉내 낸다(의존성 없음).
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const port = Number(process.env.PORT ?? 8080)
// fake-general은 OpenWebUI의 모델 편집 기록(info.meta·info.params)을 흉내 낸다 — OpenWebUI 진단(S10-5)·화면 기본값(S13-J)용
// fake_private_skill은 서비스 계정 스킬 목록에 없다 — 접근 거부(❌) 시나리오
const MODELS = [
  { id: 'fake-general', name: '가짜 범용 에이전트', info: {
    meta: { toolIds: ['fake_tool'], skillIds: ['fake_skill', 'fake_private_skill'], defaultFilterIds: ['fake_filter'], defaultFeatureIds: [], terminalId: 'fake-terminal',
      capabilities: { vision: false, file_upload: true, citations: true, web_search: true }, builtinTools: { skills: true }, knowledge: [{ id: 'fake-kb', name: '가짜 지식' }] },
    params: { function_calling: 'native' } } },
  { id: 'fake-writer', name: '가짜 문서 작성 에이전트' },
]
let rejectToolIds = process.env.FAKE_OWUI_REJECT_TOOL_IDS === '1'
/** 서비스 계정 접근(S13-J) — ok: 일반 계정(user), deny: 도구·스킬·기능 권한 없음, missing: 목록·권한 엔드포인트 없음(404) */
const ACCESS_MODES = ['ok', 'deny', 'missing']
let accessMode = ACCESS_MODES.includes(process.env.FAKE_OWUI_ACCESS) ? process.env.FAKE_OWUI_ACCESS : 'ok'
const ACCOUNT_PATHS = new Set(['/api/v1/tools/', '/api/v1/skills/', '/api/v1/users/permissions', '/api/v1/users/default/permissions'])
const uploads = new Map()
const requests = []
const captureRequests = process.env.FAKE_OWUI_E2E === '1'
/** 세션 모드 채팅(OpenWebUI v0.12 흉내) — id → { messageId, message, stopped, running(진행 작업 있음 — /api/tasks/chat/{id}) } */
const chats = new Map()
const sessionLog = { stopped: [], deleted: [] }

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

// 에이전트 추천 첫 질문(보조 호출) — 시스템 프롬프트로 알아보고 결정적인 세 줄을 돌려준다
const FIRST_QUESTIONS = '이 에이전트는 무엇을 도와주나요?\n시작하려면 어떤 자료가 필요한가요?\n결과는 어떤 형태로 받나요?'
const isFirstQuestions = (payload) => (payload.messages ?? []).some((m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('처음 물어볼 만한 질문'))
// 대화 요약 카드(보조 호출) — 같은 방식으로 알아보고 결정적인 두 줄(주제·다음)을 돌려준다
const CHAT_BRIEF = '주제: 가짜 OpenWebUI 대화 요약\n다음: 가짜 OpenWebUI가 제안하는 다음 할 일'
const isChatBrief = (payload) => (payload.messages ?? []).some((m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('요약 카드'))
// SR AI 자동작성·다듬기(보조 호출) — 제목 한 줄 + 본문, 다듬기는 추천 목록까지 결정적으로 돌려준다
const SR_COMPOSE = '제목: 가짜 OpenWebUI 자동작성 제목\n## 요청 내용\n가짜 OpenWebUI가 접수 대화로 쓴 본문'
const SR_REFINE = '제목: 가짜 OpenWebUI 다듬은 제목\n가짜 OpenWebUI가 다듬은 본문\n추천:\n- 가짜 OpenWebUI 추천 항목'
const isSrCompose = (payload) => (payload.messages ?? []).some((m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('SR 제목과 본문 초안'))
const isSrRefine = (payload) => (payload.messages ?? []).some((m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('뜻을 바꾸지 않고'))
const isAuxiliary = (payload) => isFirstQuestions(payload) || isChatBrief(payload) || isSrCompose(payload) || isSrRefine(payload)

/** 기본·legacy 모두 같은 생각·본문·첨부 시나리오를 사용한다. legacy는 sources만 앞에 더한다. */
async function completeChat(payload, res) {
  const userText = lastUserText(payload.messages)
  const text = isFirstQuestions(payload) ? FIRST_QUESTIONS : isChatBrief(payload) ? CHAT_BRIEF : isSrCompose(payload) ? SR_COMPOSE : isSrRefine(payload) ? SR_REFINE : answerText(payload, userText)
  const id = `chatcmpl-${randomUUID()}`
  if (!payload.stream) {
    return json(res, 200, { id, object: 'chat.completion', model: payload.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] })
  }
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
  const frame = body => res.write(`data: ${JSON.stringify(body)}\n\n`)
  if (payload.params?.function_calling === 'legacy' && payload.tool_ids?.length) frame({ sources: [{ source: { id: 'fake-kb' } }] })
  if (/\[reasoning\]/i.test(userText)) {
    for (const thought of ['PRIVATE_REASONING: 요청을 검토합니다. ', '자료를 비교합니다. ', '답변을 준비합니다.']) {
      if (res.destroyed) return
      frame({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { reasoning_content: thought } }] })
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  for (const piece of text.match(/.{1,8}/gsu) ?? []) {
    if (res.destroyed) return
    frame({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: piece } }] })
  }
  frame({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  // [done-linger] — [DONE] 뒤에도 연결을 열어 둔다(OpenWebUI가 outlet 필터를 기다리는 동안처럼, middleware.py 6748-6760)
  if (/\[done-linger\]/i.test(userText)) {
    res.write('data: [DONE]\n\n')
    const timer = setTimeout(() => res.end(), LINGER_MS)
    res.once('close', () => clearTimeout(timer))
    return
  }
  res.end('data: [DONE]\n\n')
}

// 실제 PNG 1×1: 브라우저가 디코딩할 수 있어야 이미지 깨짐을 E2E가 잡는다.
const IMAGE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const generatedImages = new Map()
function imageReply(owner) {
  const url = `/api/v1/files/generated-${owner}/content`
  generatedImages.set(url, owner)
  return `![generated](${url})\n\n![inline](data:image/png;base64,${IMAGE_PNG.toString('base64')})`
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
/** [tool-slow]의 도구 실행 시간, [done-linger]의 [DONE] 뒤 연결 유지 시간 */
const TOOL_MS = Number(process.env.FAKE_OWUI_TOOL_MS ?? 10_000)
const LINGER_MS = 30_000
const answerText = (payload, userText) => /\[image\]/i.test(userText) ? imageReply(payload.__imageOwner ?? randomUUID()) : `[가짜 OpenWebUI · ${payload.model ?? '?'}] 받은 메시지: ${userText} [files: ${payload.files?.length ?? 0}]`
/** OpenWebUI 세션 모드 요청 — session_id가 있고 parent_id:null(새 채팅)일 때만 백그라운드 작업이 된다 */
const isSessionRequest = payload => typeof payload.session_id === 'string' && 'parent_id' in payload && payload.parent_id === null && !payload.chat_id

/**
 * 세션 모드 진행 — 채팅 메시지를 시간에 따라 채운다. 본문은 output의 message 항목, 생각은 reasoning 항목, 상태는 statusHistory.
 * 시나리오(사용자 메시지): URL 포함 → fetch 상태 2개(읽기 2.5초)와 [fetched: URL], [delay] → 상태 3개(1초 간격), [reasoning] → 생각 3개(1초 간격),
 * [error] → 오류로 끝남, [replace] → '임시 답변'을 보였다가 최종 답으로 바꿈,
 * [tool-slow] → 본문을 먼저 쓰고 도구(fake_tool)를 TOOL_MS 동안 실행(결과 없는 function_call, middleware.py 5997-6005) 뒤 결과와 나머지 본문,
 * [done-missing] → 본문을 다 쓰고 작업은 끝나지만 done을 쓰지 않음(middleware.py 4309-4312·4429-4432처럼)
 */
async function runSession(chat, payload) {
  try { await runSessionSteps(chat, payload) } finally { chat.running = false }
}

async function runSessionSteps(chat, payload) {
  const { message } = chat
  const alive = () => chats.get(chat.id) === chat && !chat.stopped
  const status = (description, extra = {}) => message.statusHistory.push({ description, done: false, ...extra })
  const userText = lastUserText(payload.messages)
  let text = answerText({ ...payload, __imageOwner: chat.id }, userText)
  await wait(100)
  if (/\[delay\]/i.test(userText)) for (let i = 0; i < 3; i++) { if (!alive()) return; status('작업 대기 중'); await wait(1000) }
  const url = /https?:\/\/[^\s<>"')\]]+/.exec(userText)?.[0]
  if (url && payload.features?.web_search === true) {
    if (!alive()) return
    status(`URL 읽는 중: ${url}`, { action: 'fetch_url' })
    // 실제 URL 읽기처럼 폴링 간격(1초)보다 길게 — 짧으면 화면이 이 단계를 보지 못한다
    await wait(2500)
    if (!alive()) return
    status('URL 읽음', { action: 'fetch_url', done: true })
    text += ` [fetched: ${url}]`
  }
  if (/\[reasoning\]/i.test(userText)) {
    const item = { type: 'reasoning', content: [{ type: 'output_text', text: '' }] }
    message.output.push(item)
    for (const thought of ['PRIVATE_REASONING: 요청을 검토합니다. ', '자료를 비교합니다. ', '답변을 준비합니다.']) {
      if (!alive()) return
      item.content[0].text += thought
      await wait(1000)
    }
  }
  if (/\[error\]/i.test(userText)) {
    await wait(300)
    if (!alive()) return
    message.error = { content: '가짜 OpenWebUI 오류' }
    message.done = true
    return
  }
  const item = { type: 'message', content: [{ type: 'output_text', text: '' }] }
  if (/\[image\]/i.test(userText)) {
    const image = { type: 'image', url: `/api/v1/files/generated-${chat.id}/content` }
    const filesOnly = { type: 'image', url: `/cache/${chat.id}/files-only.png` }
    generatedImages.set(filesOnly.url, chat.id)
    message.files = [image]
    item.files = [image, filesOnly]
  }
  message.output.push(item)
  if (/\[replace\]/i.test(userText)) {
    item.content[0].text = message.content = '임시 답변'
    await wait(600)
    item.content[0].text = message.content = ''
  }
  const write = async (target, value) => {
    for (const piece of value.match(/.{1,8}/gsu) ?? []) {
      if (!alive()) return false
      target.content[0].text += piece
      message.content = message.output.filter(entry => entry.type === 'message').map(entry => entry.content[0].text).join('\n')
      await wait(30)
    }
    return alive()
  }
  if (!await write(item, text)) return
  if (/\[tool-slow\]/i.test(userText)) {
    const callId = `call-${randomUUID()}`
    message.output.push({ type: 'function_call', call_id: callId, name: 'fake_tool', arguments: '{}', status: 'in_progress' })
    await wait(TOOL_MS)
    if (!alive()) return
    message.output.at(-1).status = 'completed'
    message.output.push({ type: 'function_call_output', call_id: callId, output: [{ type: 'input_text', text: 'fake result' }], status: 'completed' })
    const rest = { type: 'message', content: [{ type: 'output_text', text: '' }] }
    message.output.push(rest)
    if (!await write(rest, '[tool: fake_tool 완료]')) return
  }
  if (/\[done-missing\]/i.test(userText)) return
  if (alive()) message.done = true
}

export async function handleRequest(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { status: true })
  // URL reader targets live on this test server; the application never fetches a public fixture site.
  if (captureRequests && req.method === 'GET' && url.pathname.startsWith('/__e2e/pages/')) {
    const name = url.pathname.slice('/__e2e/pages/'.length)
    if (name === 'redirect') { res.writeHead(302, { location: '/__e2e/pages/article' }); return res.end() }
    if (name === 'blocked') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end() }
    if (name === 'json') return json(res, 200, { marker: 'URL-READER-JSON' })
    if (name === 'text') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('URL-READER-TEXT') }
    if (name === 'large') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('L'.repeat(2 * 1024 * 1024 + 1)) }
    if (name === 'budget') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('B'.repeat(80_000)) }
    if (name === 'article') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end('<html><head><title>URL Reader Test</title></head><body><nav>IGNORE-NAV</nav><article><h1>사내 문서</h1><p>URL-READER-ARTICLE</p><script>IGNORE-SCRIPT</script></article></body></html>')
    }
    return json(res, 404, { detail: 'fixture not found' })
  }
  if (captureRequests && req.method === 'GET' && url.pathname === '/__e2e/requests') return json(res, 200, requests)
  if (captureRequests && req.method === 'GET' && url.pathname === '/__e2e/sessions') return json(res, 200, { active: [...chats.keys()], ...sessionLog })
  if (captureRequests && url.pathname === '/__e2e/tool-ids') {
    if (req.method === 'GET') return json(res, 200, { reject: rejectToolIds })
    if (req.method === 'POST') {
      let body
      try { body = JSON.parse((await readBody(req)).toString('utf8')) } catch { return json(res, 400, { detail: 'Invalid control' }) }
      if (!body || typeof body.reject !== 'boolean') return json(res, 400, { detail: 'Invalid control' })
      rejectToolIds = body.reject
      return json(res, 200, { reject: rejectToolIds })
    }
  }
  if (captureRequests && url.pathname === '/__e2e/owui-access') {
    if (req.method === 'GET') return json(res, 200, { mode: accessMode })
    if (req.method === 'POST') {
      let body
      try { body = JSON.parse((await readBody(req)).toString('utf8')) } catch { return json(res, 400, { detail: 'Invalid control' }) }
      if (!ACCESS_MODES.includes(body?.mode)) return json(res, 400, { detail: 'Invalid control' })
      accessMode = body.mode
      return json(res, 200, { mode: accessMode })
    }
  }
  if (req.method === 'GET' && ACCOUNT_PATHS.has(url.pathname)) {
    const deny = accessMode === 'deny'
    if (accessMode === 'missing') return json(res, 404, { detail: 'Not Found' })
    if (url.pathname === '/api/v1/tools/') return json(res, 200, deny ? [] : [{ id: 'fake_tool', name: '가짜 도구', meta: { description: '' } }])
    if (url.pathname === '/api/v1/skills/') return json(res, 200, deny ? [] : [{ id: 'fake_skill', name: '가짜 스킬', is_active: true }])
    // 관리자 전용 — 일반 계정은 401(get_admin_user)
    if (url.pathname === '/api/v1/users/default/permissions') return json(res, 401, { detail: 'Access prohibited' })
    return json(res, 200, { features: { web_search: !deny, image_generation: false, code_interpreter: false } })
  }
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
  if (req.method === 'GET' && (url.pathname.startsWith('/api/v1/files/generated-') || url.pathname.startsWith('/cache/'))) {
    if (!req.headers.authorization?.startsWith('Bearer ')) return json(res, 401, { detail: 'Unauthorized' })
    if (!generatedImages.has(url.pathname)) return json(res, 404, { detail: 'Not Found' })
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': IMAGE_PNG.length })
    return res.end(IMAGE_PNG)
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
    // 추천 첫 질문·요약 카드·SR 자동작성·다듬기는 보조 호출이라 순서를 기대하는 E2E 기록에 넣지 않는다
    if (captureRequests && !isAuxiliary(payload)) {
      requests.push(payload)
      if (requests.length > 200) requests.shift()
    }
    if (rejectToolIds && 'tool_ids' in payload) return json(res, 400, { detail: 'tool_ids is not allowed (fake reject mode)' })
    if (isSessionRequest(payload)) {
      const userText = lastUserText(payload.messages)
      if (/\[session-400\]/i.test(userText)) return json(res, 400, { detail: 'session rejected (fake)' })
      if (/\[session-format\]/i.test(userText)) return json(res, 200, { status: true })
      const id = randomUUID()
      const messageId = typeof payload.id === 'string' ? payload.id : randomUUID()
      const chat = { id, messageId, stopped: false, running: true, message: { id: messageId, parentId: null, childrenIds: [], role: 'assistant', content: '', done: false, model: payload.model, output: [], statusHistory: [] } }
      chats.set(id, chat)
      void runSession(chat, payload)
      return json(res, 200, { status: true, task_ids: [randomUUID()], chat_id: id })
    }
    return completeChat(payload, res)
  }
  const chatMatch = /^\/api\/v1\/chats\/([^/]+)$/.exec(url.pathname)
  if (chatMatch && (req.method === 'GET' || req.method === 'DELETE')) {
    const chat = chats.get(chatMatch[1])
    if (!chat) return json(res, 404, { detail: 'Not Found' })
    if (req.method === 'DELETE') {
      chats.delete(chat.id)
      for (const [url, owner] of generatedImages) if (owner === chat.id) generatedImages.delete(url)
      sessionLog.deleted.push(chat.id)
      return json(res, 200, true)
    }
    return json(res, 200, { id: chat.id, title: 'New Chat', chat: { id: chat.id, title: 'New Chat', history: { currentId: chat.messageId, messages: { [chat.messageId]: chat.message } }, messages: [] } })
  }
  // 진행 작업 목록(main.py 2171-2189) — 모르는 채팅은 빈 목록
  const tasksMatch = /^\/api\/tasks\/chat\/([^/]+)$/.exec(url.pathname)
  if (req.method === 'GET' && tasksMatch) {
    const chat = chats.get(tasksMatch[1])
    return json(res, 200, { task_ids: chat?.running && !chat.stopped ? [`task-${chat.id}`] : [] })
  }
  const stopMatch = /^\/api\/tasks\/chat\/([^/]+)\/stop$/.exec(url.pathname)
  if (req.method === 'POST' && stopMatch) {
    const chat = chats.get(stopMatch[1])
    if (!chat) return json(res, 404, { detail: 'Not Found' })
    chat.stopped = true
    sessionLog.stopped.push(chat.id)
    return json(res, 200, { status: true })
  }
  json(res, 404, { detail: 'Not Found' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(handleRequest).listen(port, () => console.log(`fake-openwebui listening on :${port}`))
}
