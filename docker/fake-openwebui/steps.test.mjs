import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { handleRequest } from './server.mjs'
async function request(url, payload) {
  const req = Readable.from(payload ? [Buffer.from(JSON.stringify(payload))] : [])
  Object.assign(req, { method: payload ? 'POST' : 'GET', url, headers: {} })
  let status, body
  await handleRequest(req, { writeHead(code) { status = code }, end(value) { body = JSON.parse(value) } })
  assert.equal(status, 200)
  return body
}
test('answer steps scenario retains message → call → output → message in a single final poll', async () => {
  const created = await request('/api/chat/completions', { model: 'fake-general', stream: true, session_id: 'steps-test', parent_id: null, id: 'answer-steps', messages: [{ role: 'user', content: '[steps] 순서 확인' }] })
  let message
  for (let i = 0; i < 200; i++) {
    const state = await request(`/api/v1/chats/${created.chat_id}`)
    message = state.chat.history.messages['answer-steps']
    if (message.done) break
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  assert.equal(message.done, true)
  assert.deepEqual(message.output.map(item => item.type), ['message', 'function_call', 'function_call_output', 'message'])
  assert.equal(message.output[1].arguments, '{"query":"raw step input"}')
  assert.equal(message.output[2].output[0].text, 'raw step result')
})
