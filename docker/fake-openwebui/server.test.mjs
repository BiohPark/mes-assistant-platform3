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

test('reasoning keyword streams reasoning_content for several seconds before answering', async () => withServer(false, async (base) => {
  const start = Date.now()
  const response = await fetch(`${base}/api/chat/completions`, { method: 'POST', body: JSON.stringify({ stream: true, model: 'fake-general', messages: [{ role: 'user', content: '[reasoning] 확인' }] }) })
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
  assert.ok(firstReasoningAt - start < 1500)
  assert.ok(firstAnswerAt - firstReasoningAt >= 2800)
}))
