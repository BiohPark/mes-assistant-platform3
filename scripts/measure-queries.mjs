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

const cases = [
  ['업무 목록', '/api/tasks'],
  ['칸반 데이터', '/api/tasks?view=kanban'],
  ['대화 상세', `/api/tasks/${encodeURIComponent(taskId)}`],
  ['자료함', `/api/tasks/${encodeURIComponent(taskId)}/candidates`],
  ['리포트 30일', '/api/reports?days=30'],
  ['SR 목록', '/api/service-requests'],
]
console.log('| 조회 | p50 (ms) | max (ms) | 목표 |')
console.log('|---|---:|---:|---:|')
for (const [name, path] of cases) {
  const times = []
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    const response = await fetch(`${base}${path}`, { headers: { Cookie: cookie } })
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
    await response.arrayBuffer()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  console.log(`| ${name} | ${times[2].toFixed(1)} | ${times[4].toFixed(1)} | 1000 ms |`)
}
