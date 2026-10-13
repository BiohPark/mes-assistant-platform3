import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createHttpServer } from 'node:http'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { health, requestUrl } from '../../../../scripts/deploy-local.mjs'
import { releaseBase } from '../../../../scripts/verify-release.mjs'

let directory
let cert
let server
let base
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'mes-health-'))
  cert = join(directory, 'ca.pem')
  const key = join(directory, 'key.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'pipe' })
  server = createHttpsServer({ cert: readFileSync(cert), key: readFileSync(key) }, (_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ status: 'ok' }))
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  base = `https://127.0.0.1:${server.address().port}`
  mkdirSync(join(directory, 'config'))
  mkdirSync(join(directory, 'app'))
}, 20_000)
afterAll(async () => {
  if (server) await new Promise((done) => server.close(done))
  if (directory) rmSync(directory, { recursive: true, force: true })
})

it('health requests accept an explicitly trusted CA and reject an untrusted certificate', async () => {
  await expect(requestUrl(base)).rejects.toThrow()
  const response = await requestUrl(base, { caFile: cert })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ status: 'ok' })
})

it('reports missing or unreadable CA files without disabling verification', async () => {
  for (const caFile of [join(directory, 'missing.pem'), directory]) {
    await expect(requestUrl(base, { caFile })).rejects.toThrow(/HTTPS_CA_FILE/)
  }
})

it('health requests still verify certificate hostnames with a trusted CA', async () => {
  const wrongCert = join(directory, 'wrong-host.pem')
  const wrongKey = join(directory, 'wrong-host-key.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', wrongKey, '-out', wrongCert,
    '-days', '1', '-subj', '/CN=wrong.example.com', '-addext', 'subjectAltName=DNS:wrong.example.com'], { stdio: 'pipe' })
  const wrong = createHttpsServer({ cert: readFileSync(wrongCert), key: readFileSync(wrongKey) }, (_req, res) => res.end('ok'))
  await new Promise((done) => wrong.listen(0, '127.0.0.1', done))
  try {
    await expect(requestUrl(`https://127.0.0.1:${wrong.address().port}`, { caFile: wrongCert })).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' })
  } finally { await new Promise((done) => wrong.close(done)) }
})

it('accepts NODE_EXTRA_CA_CERTS supplied before Node starts without an explicit CA option', async () => {
  const script = `import { requestUrl } from ${JSON.stringify(new URL('../../../../scripts/deploy-local.mjs', import.meta.url).href)}; const response = await requestUrl(process.argv[1]); console.log((await response.json()).status)`
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, base], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: cert },
  })
  expect(stdout.trim()).toBe('ok')
})

it('deploy health parses quoted env values/comments and resolves CA paths from the app working directory', async () => {
  writeFileSync(join(directory, 'config', '.env'), `APP_ORIGIN = "${base}" # test\nHTTPS_CA_FILE='../ca.pem'\n`)
  await expect(health(directory)).resolves.toBeUndefined()
})

it('HTTP health remains available without certificate settings', async () => {
  const http = createHttpServer((_req, res) => res.end('{"status":"ok"}'))
  await new Promise((done) => http.listen(0, '127.0.0.1', done))
  try {
    const response = await requestUrl(`http://127.0.0.1:${http.address().port}`)
    expect(await response.json()).toEqual({ status: 'ok' })
  } finally { await new Promise((done) => http.close(done)) }
})

it('returns a bodyless HTTP response without an uncaught callback error', async () => {
  const http = createHttpServer((_req, res) => { res.statusCode = 204; res.end() })
  await new Promise((done) => http.listen(0, '127.0.0.1', done))
  try {
    const response = await requestUrl(`http://127.0.0.1:${http.address().port}`)
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  } finally { await new Promise((done) => http.close(done)) }
})

it.each([{ status: 503, body: { status: 'down' } }, { status: 200, body: { status: 'down' } }])('deploy health rejects an unhealthy response ($status)', async ({ status, body }) => {
  const http = createHttpServer((_req, res) => { res.statusCode = status; res.end(JSON.stringify(body)) })
  await new Promise((done) => http.listen(0, '127.0.0.1', done))
  try {
    writeFileSync(join(directory, 'config', '.env'), `APP_ORIGIN=http://127.0.0.1:${http.address().port}\n`)
    await expect(health(directory)).rejects.toThrow(/health 확인 실패/)
  } finally { await new Promise((done) => http.close(done)) }
})

it('release verification selects HTTPS for either certificate format and HTTP by default', () => {
  expect(releaseBase({}, 12345)).toBe('http://127.0.0.1:12345')
  expect(releaseBase({ HTTPS_PFX_FILE: 'cert.pfx' }, 12345)).toBe('https://127.0.0.1:12345')
  expect(releaseBase({ HTTPS_CERT_FILE: 'cert.pem', HTTPS_KEY_FILE: 'key.pem' }, 12345)).toBe('https://127.0.0.1:12345')
})
