import { performance } from 'node:perf_hooks'

const base = (process.env.PERF_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const loginId = process.env.PERF_LOGIN_ID
const password = process.env.PERF_PASSWORD
const taskId = process.env.PERF_TASK_ID ?? 'scale-task-1'
if (!loginId || !password) throw new Error('PERF_LOGIN_ID와 PERF_PASSWORD가 필요합니다')

const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId, password }) })
if (!login.ok) throw new Error(`로그인 실패: HTTP ${login.status}`)
const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
if (!cookie) throw new Error('세션 쿠키가 없습니다')

async function timed(path, options = {}) {
  const start = performance.now()
  const response = await fetch(`${base}${path}`, { ...options, headers: { Cookie: cookie, ...options.headers } })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  const body = await response.arrayBuffer()
  return { ms: performance.now() - start, body }
}

async function detail() {
  const id = encodeURIComponent(taskId)
  const task = await timed(`/api/tasks/${id}`)
  const { threadId, tags = [] } = JSON.parse(Buffer.from(task.body).toString('utf8'))
  if (!threadId) throw new Error('대화 상세에 threadId가 없습니다')
  const thread = encodeURIComponent(threadId)
  const paths = ['/api/me', '/api/assistants', '/api/catalog/users', '/api/tags/suggest?prefix=', '/api/settings', '/api/llm/models',
    `/api/tasks/${id}/activity`, `/api/threads/${thread}/messages`, ...tags.map((tag) => `/api/tasks?${new URLSearchParams({ 'tag[]': tag })}`)]
  const calls = paths.map((path) => timed(path))
  calls.push(timed(`/api/threads/${thread}/requests/estimate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: '' }) }))
  const results = await Promise.all(calls)
  return task.ms + results.reduce((sum, result) => sum + result.ms, 0)
}

const cases = [
  ['전체 대화 칸반·업무 목록', () => timed('/api/tasks').then((result) => result.ms)],
  ['대화 상세 화면 API 합계', detail],
  ['자료 후보 API', () => timed(`/api/tasks/${encodeURIComponent(taskId)}/candidates`).then((result) => result.ms)],
  ['리포트 30일', () => timed('/api/reports?days=30').then((result) => result.ms)],
  ['SR 목록', () => timed('/api/service-requests').then((result) => result.ms)],
]
console.log('| 조회 | p50 (ms) | max (ms) | 목표 |')
console.log('|---|---:|---:|---:|')
for (const [name, measure] of cases) {
  const times = []
  for (let i = 0; i < 5; i++) times.push(await measure())
  times.sort((a, b) => a - b)
  console.log(`| ${name} | ${times[2].toFixed(1)} | ${times[4].toFixed(1)} | 1000 ms |`)
}
