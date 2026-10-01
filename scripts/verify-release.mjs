import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const bundle = resolve(import.meta.dirname, '..', 'release', 'mes-hub')
if (!existsSync(join(bundle, 'api', 'dist', 'main.js'))) throw new Error('먼저 pnpm release를 실행하세요')
const isolated = mkdtempSync(join(tmpdir(), 'mes-release-'))
cpSync(bundle, isolated, { recursive: true })

const port = 40000 + Math.floor(Math.random() * 20000)
const base = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['--env-file=.env.example', 'api/dist/main.js'], {
  cwd: isolated,
  env: { ...process.env, API_PORT: String(port), APP_ORIGIN: base },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
server.stdout.on('data', (chunk) => { output += chunk.toString() })
server.stderr.on('data', (chunk) => { output += chunk.toString() })

try {
  let page
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null) throw new Error(`묶음 서버 종료: ${output}`)
    try { page = await fetch(base); break }
    catch { await new Promise((done) => setTimeout(done, 250)) }
  }
  if (!page || page.status !== 200 || !((await page.text()).includes('<html'))) throw new Error(`web 루트 응답 오류: ${page?.status}\n${output}`)
  const route = await fetch(`${base}/c/abc`)
  if (route.status !== 200 || !((await route.text()).includes('<html'))) throw new Error('SPA 경로 응답 오류')
  const mode = await fetch(`${base}/api/auth/mode`)
  if (mode.status !== 200 || (await mode.json()).mode !== 'local') throw new Error('api 응답 오류')
  const missing = await fetch(`${base}/api/missing`)
  if (missing.status !== 404 || !missing.headers.get('content-type')?.includes('json')) throw new Error('api 404 응답 오류')
  console.log('배포 묶음 기동 확인: /, /c/abc, /api/auth/mode, /api/missing')
} finally {
  server.kill()
  await new Promise((done) => { if (server.exitCode !== null || server.signalCode !== null) done(); else server.once('exit', done) })
  rmSync(isolated, { recursive: true, force: true })
}
