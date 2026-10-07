import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('release 검증은 점유된 포트를 피해 서버를 띄운다', async () => {
  let reservation
  let port
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = 40000 + Math.floor(Math.random() * 20000)
    const server = createServer()
    try {
      await new Promise((done, fail) => server.once('error', fail).listen(candidate, '127.0.0.1', done))
      reservation = server
      port = candidate
      break
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error
    }
  }
  assert.ok(port >= 40000 && port < 60000, `테스트용 포트가 기존 선택 범위 밖입니다: ${port}`)
  const directory = mkdtempSync(join(tmpdir(), 'mes-verify-port-'))
  const preload = join(directory, 'port.mjs')
  writeFileSync(preload, `Math.random = () => (${port} - 40000 + 0.1) / 20000\n`)
  try {
    const result = await new Promise((done) => {
      const child = spawn(process.execPath, ['--import', preload, resolve(import.meta.dirname, '../scripts/verify-release.mjs')], {
        cwd: resolve(import.meta.dirname, '..'),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      const timeout = setTimeout(() => { child.kill(); output += '\n검증 시간 초과' }, 30000)
      child.stdout.on('data', (chunk) => { output += chunk })
      child.stderr.on('data', (chunk) => { output += chunk })
      child.on('close', (code) => { clearTimeout(timeout); done({ code, output }) })
    })
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /배포 묶음 기동 확인/)
  } finally {
    reservation?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
