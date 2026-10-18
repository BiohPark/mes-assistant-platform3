import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { handleRequest } from './server.mjs'

// HTTP 핸들러 자체를 검사한다. 포트를 열지 않아도 삭제 전후 바이트·인증 동작을 재현한다.
async function request(path, options = {}) {
  const req = Readable.from(options.body ? [Buffer.from(options.body)] : [])
  Object.assign(req, { method: options.method ?? 'GET', url: path, headers: options.headers ?? {} })
  let status = 200, headers = {}, body = []
  const res = { destroyed: false,
    writeHead(code, value) { status = code; headers = value },
    write(value) { body.push(Buffer.from(value)) },
    end(value) { if (value) body.push(Buffer.from(value)) },
  }
  await handleRequest(req, res)
  return new Response(Buffer.concat(body), { status, headers })
}
const complete = body => request('/api/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'fake-general', messages: [{ role: 'user', content: '[image] draw' }], ...body }) })

test('concurrent image requests retain their prompt and only delete their own session images', async () => {
  const sessionPrompt = '[image] draw task=session-isolation'
  const directPrompt = '[image] draw task=direct-isolation'
  const [session, direct] = await Promise.all([
    complete({ session_id: 'image-isolation', parent_id: null, id: 'reply', messages: [{ role: 'user', content: sessionPrompt }] }),
    complete({ messages: [{ role: 'user', content: directPrompt }] }),
  ])
  const { chat_id } = await session.json()
  const directContent = (await direct.json()).choices[0].message.content
  const directUrl = /!\[generated\]\(([^)]+)\)/.exec(directContent)?.[1]
  let message
  try {
    for (let i = 0; i < 300; i++) {
      message = (await (await request(`/api/v1/chats/${chat_id}`)).json()).chat.history.messages.reply
      if (message.done) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(message.done, true)
    assert.ok(message.content.includes(sessionPrompt))
    assert.ok(!message.content.includes(directPrompt))
    assert.ok(directContent.includes(directPrompt))
    assert.ok(!directContent.includes(sessionPrompt))
    assert.ok(directUrl)
    assert.ok(!message.content.includes(directUrl))
    assert.equal((await request(`/api/v1/chats/${chat_id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await request(`/api/v1/files/generated-${chat_id}/content`, { headers: { authorization: 'Bearer key' } })).status, 404)
    assert.equal((await request(directUrl, { headers: { authorization: 'Bearer key' } })).status, 200)
  } finally {
    await request(`/api/v1/chats/${chat_id}`, { method: 'DELETE' })
  }
})

test('image session exposes markdown and output files before DELETE, then image URLs return 404', async () => {
  const { chat_id } = await (await complete({ session_id: 'images', parent_id: null, id: 'reply' })).json()
  let message
  for (let i = 0; i < 300; i++) {
    message = (await (await request(`/api/v1/chats/${chat_id}`)).json()).chat.history.messages.reply
    if (message.done) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(message.done, true)
  assert.equal(message.files.length, 1)
  const output = message.output.find(item => item.type === 'message')
  assert.equal(output.files.length, 2)
  assert.match(message.content, /!\[generated\]\(\/api\/v1\/files\//)
  assert.match(message.content, /data:image\/png;base64,/)
  const urls = output.files.map(file => file.url)
  for (const url of urls) {
    assert.equal((await request(url)).status, 401)
    const response = await request(url, { headers: { authorization: 'Bearer e2e-fake-key' } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.ok((await response.arrayBuffer()).byteLength > 0)
  }
  assert.equal((await request(`/api/v1/chats/${chat_id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await request(`/api/v1/chats/${chat_id}`)).status, 404)
  for (const url of urls) assert.equal((await request(url, { headers: { authorization: 'Bearer e2e-fake-key' } })).status, 404)
})

test('direct image scenario includes a downloadable relative URL and a data image', async () => {
  const response = await complete({ stream: true })
  const content = (await response.text()).split('\n\n').filter(frame => frame.startsWith('data: ') && frame !== 'data: [DONE]')
    .map(frame => JSON.parse(frame.slice(6)).choices?.[0]?.delta?.content ?? '').join('')
  const url = /!\[generated\]\(([^)]+)\)/.exec(content)?.[1]
  assert.ok(url?.startsWith('/api/v1/files/'))
  assert.match(content, /data:image\/png;base64,/)
  assert.equal((await request(url, { headers: { authorization: 'Bearer e2e-fake-key' } })).status, 200)
})
