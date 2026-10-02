import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import test from 'node:test'

test('측정은 칸반 중복 없이 대화 상세의 화면 요청을 합산한다', async () => {
  const paths = []
  const server = createServer((req, res) => {
    paths.push(`${req.method} ${req.url}`)
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/auth/login') res.setHeader('set-cookie', 'mes_session=test; Path=/')
    res.end(JSON.stringify(req.url === '/api/tasks/scale-task-1' ? { threadId: 'scale-thread-1', tags: ['scale'] } : {}))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const child = spawn(process.execPath, ['scripts/measure-queries.mjs'], { env: { ...process.env,
      PERF_BASE_URL: `http://127.0.0.1:${address.port}`, PERF_LOGIN_ID: 'test', PERF_PASSWORD: 'password' } })
    let output = '', errors = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { errors += chunk })
    const exit = await new Promise((resolve) => child.on('exit', resolve))
    assert.equal(exit, 0, errors)
    assert.doesNotMatch(output, /칸반 데이터/)
    assert.equal(paths.filter((path) => path === 'GET /api/tasks').length, 5)
    assert.equal(paths.filter((path) => path === 'GET /api/tasks/scale-task-1').length, 5)
    assert.equal(paths.filter((path) => path === 'GET /api/threads/scale-thread-1/messages').length, 5)
    assert.equal(paths.filter((path) => path === 'GET /api/tasks/scale-task-1/activity').length, 5)
    assert.equal(paths.filter((path) => path === 'GET /api/tasks?tag%5B%5D=scale').length, 5)
    assert.equal(paths.filter((path) => path === 'POST /api/threads/scale-thread-1/requests/estimate').length, 5)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})
