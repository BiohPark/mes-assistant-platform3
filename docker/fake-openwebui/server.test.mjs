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
