import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, request } from 'node:https'
import { parseEnv } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config/config.js'
import { httpsOriginWarning, loadHttpsOptions, parseHttpsConfig } from './https.js'

const base = { DATABASE_URL: 'mysql://unused', SESSION_SECRET: 'x'.repeat(32), APP_ORIGIN: 'http://localhost:5173' }
let directory: string
let cert: string
let key: string
let pfx: string
const passphrase = 'test-only-secret'

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'mes-https-'))
  cert = join(directory, 'cert.pem')
  key = join(directory, 'key.pem')
  pfx = join(directory, 'cert.pfx')
  // OpenSSL is required on test hosts; no certificate/key fixtures live in the repository.
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'pipe' })
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', key, '-in', cert, '-out', pfx, '-passout', 'env:MES_TEST_PFX_PASSWORD'],
    { stdio: 'pipe', env: { ...process.env, MES_TEST_PFX_PASSWORD: passphrase } })
}, 20_000)
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })

describe('optional direct HTTPS', () => {
  it('keeps HTTP defaults and ignores empty settings', () => {
    expect(loadConfig(base).https).toBeUndefined()
    expect(parseHttpsConfig({ HTTPS_PFX_FILE: '', HTTPS_CERT_FILE: '', HTTPS_KEY_FILE: '', HTTPS_CA_FILE: '', HTTPS_PFX_PASSPHRASE: '' })).toBeUndefined()
    expect(loadHttpsOptions(undefined)).toBeUndefined()
  })

  it.each([
    { HTTPS_CERT_FILE: 'cert.pem' }, { HTTPS_KEY_FILE: 'key.pem' }, { HTTPS_CA_FILE: 'ca.pem' },
    { HTTPS_PFX_PASSPHRASE: passphrase },
    { HTTPS_PFX_FILE: 'cert.pfx', HTTPS_CERT_FILE: 'cert.pem', HTTPS_KEY_FILE: 'key.pem' },
    { HTTPS_PFX_FILE: 'cert.pfx', HTTPS_KEY_FILE: 'key.pem' },
    { HTTPS_PFX_FILE: 'cert.pfx', HTTPS_CA_FILE: 'ca.pem' },
    { HTTPS_CERT_FILE: 'cert.pem', HTTPS_KEY_FILE: 'key.pem', HTTPS_PFX_PASSPHRASE: passphrase },
  ])('rejects mixed/incomplete settings without revealing passwords', (env) => {
    expect(() => loadConfig({ ...base, ...env })).toThrow(/HTTPS_/)
    try { loadConfig({ ...base, ...env }) } catch (error) { expect(String(error)).not.toContain(passphrase) }
  })

  it.each(['C:\\Program Files\\mes\\cert.pfx', '\\\\fileserver\\certificates\\cert.pfx'])('accepts Windows paths unchanged: %s', (path) => {
    expect(parseHttpsConfig({ HTTPS_PFX_FILE: path })).toEqual({ pfxFile: path, passphrase: undefined })
  })

  it('keeps Windows paths through .env parsing with single quotes, slashes or no quotes', () => {
    const env = parseEnv([
      String.raw`HTTPS_CERT_FILE='C:\new certs\server-chain.pem'`,
      'HTTPS_KEY_FILE=C:/new certs/server-key.pem',
      String.raw`HTTPS_CA_FILE=\\fileserver\new\ca-chain.pem`,
    ].join('\n'))
    expect(parseHttpsConfig(env)).toEqual({
      certFile: String.raw`C:\new certs\server-chain.pem`,
      keyFile: 'C:/new certs/server-key.pem',
      caFile: String.raw`\\fileserver\new\ca-chain.pem`,
    })
  })

  it.each(['HTTPS_PFX_FILE', 'HTTPS_CERT_FILE', 'HTTPS_KEY_FILE', 'HTTPS_CA_FILE'])(
    'rejects a double-quoted Windows path that .env parsing broke with a newline: %s', (name) => {
      const others = name === 'HTTPS_PFX_FILE' ? {} : { HTTPS_CERT_FILE: 'cert.pem', HTTPS_KEY_FILE: 'key.pem' }
      const env: Record<string, string | undefined> = { ...others, ...parseEnv(String.raw`${name}="C:\new certs\server.pem"`) }
      expect(env[name]).toContain('\n')
      expect(() => parseHttpsConfig(env)).toThrow(new RegExp(`${name}.*따옴표`))
    })

  it('rejects tabs and other control characters in certificate paths', () => {
    expect(() => parseHttpsConfig({ HTTPS_PFX_FILE: 'C:\\certs\tserver.pfx' })).toThrow(/HTTPS_PFX_FILE.*따옴표/)
  })

  it('loads PEM with an optional CA and password-protected PFX', () => {
    const pem = loadHttpsOptions(parseHttpsConfig({ HTTPS_CERT_FILE: cert, HTTPS_KEY_FILE: key, HTTPS_CA_FILE: cert }))
    expect(pem?.cert).toEqual(readFileSync(cert))
    expect(pem?.key).toEqual(readFileSync(key))
    expect(pem?.ca).toEqual(readFileSync(cert))
    expect(loadHttpsOptions(parseHttpsConfig({ HTTPS_PFX_FILE: pfx, HTTPS_PFX_PASSPHRASE: passphrase }))?.pfx).toEqual(readFileSync(pfx))
  })

  it('loads a PFX without a passphrase when the file has no password', () => {
    const unprotected = join(directory, 'unprotected.pfx')
    execFileSync('openssl', ['pkcs12', '-export', '-inkey', key, '-in', cert, '-out', unprotected, '-passout', 'pass:'], { stdio: 'pipe' })
    expect(loadHttpsOptions(parseHttpsConfig({ HTTPS_PFX_FILE: unprotected }))?.pfx).toEqual(readFileSync(unprotected))
  })

  it.each(['HTTPS_CERT_FILE', 'HTTPS_KEY_FILE', 'HTTPS_CA_FILE', 'HTTPS_PFX_FILE'])('reports missing/unreadable files by setting name: %s', (setting) => {
    for (const path of [join(directory, 'missing'), directory]) {
      const env = setting === 'HTTPS_PFX_FILE' ? { HTTPS_PFX_FILE: path } : { HTTPS_CERT_FILE: cert, HTTPS_KEY_FILE: key, HTTPS_CA_FILE: cert, [setting]: path }
      expect(() => loadHttpsOptions(parseHttpsConfig(env))).toThrow(new RegExp(setting))
    }
  })

  it('rejects corrupt material and wrong passwords before bootstrap without leaking secrets', () => {
    const invalid = join(directory, 'invalid.pem')
    writeFileSync(invalid, passphrase)
    for (const env of [
      { HTTPS_PFX_FILE: pfx, HTTPS_PFX_PASSPHRASE: 'wrong-password' },
      { HTTPS_PFX_FILE: pfx },
      { HTTPS_PFX_FILE: invalid },
      { HTTPS_CERT_FILE: invalid, HTTPS_KEY_FILE: key },
      { HTTPS_CERT_FILE: cert, HTTPS_KEY_FILE: invalid },
    ]) {
      expect(() => loadHttpsOptions(parseHttpsConfig(env))).toThrow(/HTTPS/)
      try { loadHttpsOptions(parseHttpsConfig(env)) } catch (error) {
        expect(String(error)).not.toContain(passphrase)
        expect(String(error)).not.toContain('wrong-password')
      }
    }
  })

  it('warns for an HTTP APP_ORIGIN while preserving the Secure-cookie rule', () => {
    const http = loadConfig({ ...base, HTTPS_PFX_FILE: pfx })
    expect(http.cookieSecure).toBe(false)
    expect(httpsOriginWarning(http)).toMatch(/APP_ORIGIN.*http.*Secure/)
    const https = loadConfig({ ...base, APP_ORIGIN: 'https://localhost:8443', HTTPS_PFX_FILE: pfx })
    expect(https.cookieSecure).toBe(true)
    expect(httpsOriginWarning(https)).toBeUndefined()
    expect(httpsOriginWarning(loadConfig(base))).toBeUndefined()
  })

  it.each(['pem', 'pfx'])('serves a trusted TLS response with %s options on an ephemeral port', async (format) => {
    const env = format === 'pem' ? { HTTPS_CERT_FILE: cert, HTTPS_KEY_FILE: key } : { HTTPS_PFX_FILE: pfx, HTTPS_PFX_PASSPHRASE: passphrase }
    const server = createServer(loadHttpsOptions(parseHttpsConfig(env))!, (_req, res) => res.end('ok'))
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No port')
      const body = await new Promise<string>((done, fail) => {
        request(`https://127.0.0.1:${address.port}`, { ca: readFileSync(cert) }, (response) => {
          let body = ''
          response.on('data', (chunk) => { body += chunk })
          response.on('end', () => done(body))
        }).on('error', fail).end()
      })
      expect(body).toBe('ok')
    } finally { await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done())) }
  })
})
