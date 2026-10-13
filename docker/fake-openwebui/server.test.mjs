import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

async function withServer(enabled, run) {
  const port = 35000 + Math.floor(Math.random() * 20000)
  const child = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], {
    env: { ...process.env, PORT: String(port), FAKE_OWUI_E2E: enabled ? '1' : '' }, stdio: 'ignore',
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
