import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

async function withServer(enabled, run, extraEnv = {}) {
  const port = 35000 + Math.floor(Math.random() * 20000)
  const child = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], {
    env: { ...process.env, PORT: String(port), FAKE_OWUI_E2E: enabled ? '1' : '', ...extraEnv }, stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/health`)).ok) break } catch { /* server starting */ }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    await run(base)
  } finally { child.kill(); await new Promise((resolve) => child.once('exit', resolve)) }
}

test('request capture is disabled by default', async () => withServer(false, async (base) => {
  await fetch(`${base}/api/chat/completions`, { method: 'POST', body: JSON.stringify({ model: 'fake-general', messages: [{ role: 'user', content: 'private' }] }) })
  assert.equal((await fetch(`${base}/__e2e/requests`)).status, 404)
}))

test('E2E request capture keeps only the latest 200', async () => withServer(true, async (base) => {
  for (let i = 0; i < 201; i++) {
    await fetch(`${base}/api/chat/completions`, { method: 'POST', body: JSON.stringify({ model: 'fake-general', messages: [{ role: 'user', content: String(i) }] }) })
  }
  const requests = await (await fetch(`${base}/__e2e/requests`)).json()
  assert.equal(requests.length, 200)
  assert.equal(requests[0].messages[0].content, '1')
  assert.equal(requests[199].messages[0].content, '200')
}))

const chat = (base, body) => fetch(`${base}/api/chat/completions`, { method: 'POST', body: JSON.stringify({ model: 'fake-general', messages: [{ role: 'user', content: 'hi' }], stream: true, ...body }) })
const modes = [
  { name: 'basic', body: {} },
  { name: 'legacy', body: { tool_ids: ['fake_tool'], features: { web_search: true }, params: { function_calling: 'legacy' } } },
]
const frames = body => body.split('\n\n').filter(frame => frame.startsWith('data: ') && frame !== 'data: [DONE]').map(frame => JSON.parse(frame.slice(6)))
const answer = body => frames(body).map(frame => frame.choices?.[0]?.delta?.content ?? '').join('')

test('version and model meta mimic OpenWebUI for the diagnostics probe', async () => withServer(false, async (base) => {
  assert.deepEqual(await (await fetch(`${base}/api/version`)).json(), { version: '0.0.0-fake' })
  const { data } = await (await fetch(`${base}/api/models`)).json()
  const general = data.find((m) => m.id === 'fake-general')
  assert.deepEqual(general.info.meta.toolIds, ['fake_tool'])
  assert.deepEqual(general.info.meta.defaultFeatureIds, ['web_search'])
  assert.equal(general.info.meta.knowledge.length, 1)
  assert.equal(general.info.params.function_calling, 'native')
  assert.equal(data.find((m) => m.id === 'fake-writer').info, undefined)
}))

test('legacy tool calls stream a sources frame first; tool_ids are rejected (400) in reject mode', async () => {
  await withServer(false, async (base) => {
    const text = await (await chat(base, { tool_ids: ['fake_tool'], params: { function_calling: 'legacy' } })).text()
    assert.match(text.split('\n\n')[0], /^data: \{"sources":/)
    assert.doesNotMatch(await (await chat(base, {})).text(), /sources/)
  })
  await withServer(false, async (base) => {
    const rejected = await chat(base, { tool_ids: ['fake_tool'] })
    assert.equal(rejected.status, 400)
    assert.match((await rejected.json()).detail, /tool_ids/)
    assert.equal((await chat(base, {})).status, 200)
  }, { FAKE_OWUI_REJECT_TOOL_IDS: '1' })
})

for (const mode of modes) test(`${mode.name}: reasoning streams every thought before the same answer`, async () => withServer(false, async (base) => {
  const start = Date.now()
  const response = await chat(base, { ...mode.body, messages: [{ role: 'user', content: '[reasoning] 확인' }] })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let body = '', firstReasoningAt, firstAnswerAt
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const piece = decoder.decode(value, { stream: true })
    body += piece
    if (piece.includes('reasoning_content')) firstReasoningAt ??= Date.now()
    if (piece.includes('"content"')) firstAnswerAt ??= Date.now()
  }
  assert.ok(body.includes('PRIVATE_REASONING'))
  assert.ok(body.includes('data: [DONE]'))
  assert.deepEqual(frames(body).filter(frame => frame.choices?.[0]?.delta?.reasoning_content).map(frame => frame.choices[0].delta.reasoning_content),
    ['PRIVATE_REASONING: 요청을 검토합니다. ', '자료를 비교합니다. ', '답변을 준비합니다.'])
  assert.equal(answer(body), '[가짜 OpenWebUI · fake-general] 받은 메시지: [reasoning] 확인 [files: 0]')
  assert.equal(!!frames(body)[0].sources, mode.name === 'legacy')
  assert.ok(firstReasoningAt - start < 1500)
  assert.ok(firstAnswerAt - firstReasoningAt >= 2800)
}))

test('basic and legacy preserve two uploaded files, including slow processing, in streamed and JSON answers', async () => withServer(true, async base => {
  const upload = async name => {
    const body = new FormData()
    body.append('file', new Blob(['fixture']), name)
    const response = await fetch(`${base}/api/v1/files/`, { method: 'POST', body })
    assert.equal(response.status, 200)
    return (await response.json()).id
  }
  const start = Date.now()
  const files = await Promise.all(['main-e2e.txt', 'slow-e2e.txt'].map(async name => ({ type: 'file', id: await upload(name) })))
  const status = async file => (await (await fetch(`${base}/api/v1/files/${file.id}/process/status`)).json()).status
  assert.deepEqual(await Promise.all(files.map(status)), ['pending', 'pending'])
  while (await status(files[0]) !== 'completed') {
    assert.ok(Date.now() - start < 12_000, 'normal file processing timed out')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(await status(files[1]), 'pending')
  while (await status(files[1]) !== 'completed') {
    assert.ok(Date.now() - start < 12_000, 'slow file processing timed out')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(Date.now() - start >= 8000)
  for (const mode of modes) for (const stream of [true, false]) {
    const response = await chat(base, { ...mode.body, stream, files, messages: [{ role: 'user', content: '첨부 확인' }] })
    assert.equal(response.status, 200)
    const text = stream ? answer(await response.text()) : (await response.json()).choices[0].message.content
    assert.equal(text, '[가짜 OpenWebUI · fake-general] 받은 메시지: 첨부 확인 [files: 2]')
  }
  const captured = await (await fetch(`${base}/__e2e/requests`)).json()
  assert.equal(captured.length, 4)
  for (const request of captured) assert.deepEqual(request.files, files)
}))

test('tool rejection control exists only in E2E mode and preserves captured attempts', async () => {
  await withServer(false, async base => {
    assert.equal((await fetch(`${base}/__e2e/tool-ids`)).status, 404)
    assert.equal((await fetch(`${base}/__e2e/tool-ids`, { method: 'POST', body: '{"reject":true}' })).status, 404)
  })
  await withServer(true, async base => {
    const toggle = reject => fetch(`${base}/__e2e/tool-ids`, { method: 'POST', body: JSON.stringify({ reject }) })
    assert.deepEqual(await (await fetch(`${base}/__e2e/tool-ids`)).json(), { reject: false })
    assert.equal((await toggle('bad')).status, 400)
    assert.equal((await toggle(true)).status, 200)
    assert.equal((await chat(base, { tool_ids: ['fake_tool'], features: { web_search: true }, params: { function_calling: 'legacy' } })).status, 400)
    assert.equal((await chat(base, {})).status, 200)
    const attempts = await (await fetch(`${base}/__e2e/requests`)).json()
    assert.equal(attempts.length, 2)
    assert.deepEqual(attempts[0].tool_ids, ['fake_tool'])
    assert.equal('tool_ids' in attempts[1], false)
    assert.equal((await toggle(false)).status, 200)
    assert.equal((await chat(base, { tool_ids: ['fake_tool'] })).status, 200)
  })
})

test('first-question suggestion calls get a deterministic three-line answer and stay out of the E2E capture', async () => withServer(true, async base => {
  const system = { role: 'system', content: '다음 AI 에이전트에게 사용자가 처음 물어볼 만한 질문 3개를 한국어로 만들어라.' }
  const expected = '이 에이전트는 무엇을 도와주나요?\n시작하려면 어떤 자료가 필요한가요?\n결과는 어떤 형태로 받나요?'
  for (const stream of [true, false]) {
    const response = await chat(base, { stream, messages: [system, { role: 'user', content: '이름: 분석 도우미\n설명: ' }] })
    assert.equal(stream ? answer(await response.text()) : (await response.json()).choices[0].message.content, expected)
  }
  assert.deepEqual(await (await fetch(`${base}/__e2e/requests`)).json(), [])
}))

// 세션 모드(S12, OpenWebUI v0.12): session_id·id·parent_id:null → chat_id만 즉시, 결과는 채팅 GET으로
const session = (base, content, body = {}) => chat(base, { session_id: 'mes-test', id: 'msg-1', parent_id: null, messages: [{ role: 'user', content }], ...body })
async function pollUntilDone(base, chatId, timeoutMs = 10_000) {
  const start = Date.now(), seen = []
  for (;;) {
    const response = await fetch(`${base}/api/v1/chats/${chatId}`)
    assert.equal(response.status, 200)
    const message = (await response.json()).chat.history.messages['msg-1']
    seen.push(message)
    if (message.done) return { message, seen }
    assert.ok(Date.now() - start < timeoutMs, 'session did not finish')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
const outputText = (message, type) => message.output.filter(item => item.type === type).map(item => item.content.map(part => part.text).join('')).join('\n')

test('session mode returns chat_id at once and the chat shows the same answer as the stream, then DELETE removes it', async () => withServer(true, async base => {
  const created = await session(base, 'hi')
  assert.equal(created.status, 200)
  const body = await created.json()
  assert.deepEqual(Object.keys(body).sort(), ['chat_id', 'status', 'task_ids'])
  const { message, seen } = await pollUntilDone(base, body.chat_id)
  assert.equal(outputText(message, 'message'), '[가짜 OpenWebUI · fake-general] 받은 메시지: hi [files: 0]')
  assert.equal(message.content, outputText(message, 'message'))
  assert.ok(seen.some(item => !item.done && outputText(item, 'message').length > 0), 'content should grow before done')
  assert.equal((await fetch(`${base}/api/v1/chats/${body.chat_id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await fetch(`${base}/api/v1/chats/${body.chat_id}`)).status, 404)
  assert.deepEqual(await (await fetch(`${base}/__e2e/sessions`)).json(), { active: [], stopped: [], deleted: [body.chat_id] })
  assert.equal((await (await fetch(`${base}/__e2e/requests`)).json())[0].session_id, 'mes-test')
}))

test('session URL scenario records fetch status entries and mentions the fetched URL; reasoning goes to output reasoning items', async () => withServer(false, async base => {
  const { chat_id } = await (await session(base, '[reasoning] https://example.com/page 요약')).json()
  const { message, seen } = await pollUntilDone(base, chat_id)
  assert.deepEqual(message.statusHistory.map(item => item.description), ['URL 읽는 중: https://example.com/page', 'URL 읽음'])
  assert.ok(seen.some(item => !item.done && item.statusHistory.length === 1), 'fetch status should be visible while running')
  // 1초 폴링이 적어도 한 번은 'URL 읽는 중'을 보도록 읽기 단계가 폴링 간격보다 길다
  assert.ok(seen.filter(item => item.statusHistory.length === 1).length * 50 >= 1500, 'fetch status should outlast the 1s poll interval')
  assert.match(outputText(message, 'message'), /\[fetched: https:\/\/example\.com\/page\]$/)
  assert.equal(outputText(message, 'reasoning'), 'PRIVATE_REASONING: 요청을 검토합니다. 자료를 비교합니다. 답변을 준비합니다.')
  assert.doesNotMatch(outputText(message, 'message'), /PRIVATE_REASONING/)
}))

test('session delay scenario keeps adding status entries before the answer', async () => withServer(false, async base => {
  const start = Date.now()
  const { chat_id } = await (await session(base, '[delay] 기다려')).json()
  const { message } = await pollUntilDone(base, chat_id)
  assert.ok(Date.now() - start >= 2500)
  assert.deepEqual(message.statusHistory.map(item => item.description), ['작업 대기 중', '작업 대기 중', '작업 대기 중'])
}))

test('session error and replace scenarios', async () => withServer(false, async base => {
  const failed = await pollUntilDone(base, (await (await session(base, '[error] 실패')).json()).chat_id)
  assert.deepEqual(failed.message.error, { content: '가짜 OpenWebUI 오류' })
  const replaced = await pollUntilDone(base, (await (await session(base, '[replace] 바꿔')).json()).chat_id)
  assert.ok(replaced.seen.some(item => outputText(item, 'message') === '임시 답변'))
  assert.equal(outputText(replaced.message, 'message'), '[가짜 OpenWebUI · fake-general] 받은 메시지: [replace] 바꿔 [files: 0]')
}))

test('session creation can be rejected (400) or answered in another shape; plain requests still stream', async () => withServer(false, async base => {
  assert.equal((await session(base, '[session-400] 거부')).status, 400)
  const other = await session(base, '[session-format] 형식')
  assert.equal(other.status, 200)
  assert.equal('chat_id' in await other.json(), false)
  assert.equal(answer(await (await chat(base, { messages: [{ role: 'user', content: '[session-400] 거부' }] })).text()), '[가짜 OpenWebUI · fake-general] 받은 메시지: [session-400] 거부 [files: 0]')
  assert.equal((await session(base, 'x', { parent_id: 'p1' })).headers.get('content-type')?.includes('text/event-stream'), true)
}, { FAKE_OWUI_REJECT_TOOL_IDS: '' }))

test('session stop halts the task, keeps the partial chat and is recorded', async () => withServer(true, async base => {
  const { chat_id } = await (await session(base, '[delay] 멈춰')).json()
  assert.equal((await fetch(`${base}/api/tasks/chat/${chat_id}/stop`, { method: 'POST' })).status, 200)
  await new Promise(resolve => setTimeout(resolve, 1500))
  const message = (await (await fetch(`${base}/api/v1/chats/${chat_id}`)).json()).chat.history.messages['msg-1']
  assert.equal(outputText(message, 'message'), '')
  assert.deepEqual((await (await fetch(`${base}/__e2e/sessions`)).json()).stopped, [chat_id])
  assert.equal((await fetch(`${base}/api/tasks/chat/missing/stop`, { method: 'POST' })).status, 404)
}))

test('session tool rejection follows the same reject mode', async () => withServer(false, async base => {
  assert.equal((await session(base, 'hi', { tool_ids: ['fake_tool'] })).status, 400)
  assert.equal((await session(base, 'hi')).status, 200)
}, { FAKE_OWUI_REJECT_TOOL_IDS: '1' }))
