import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

test('init, dry-run, update and rollback keep config and storage outside app', () => {
  const root = mkdtempSync(join(tmpdir(), 'mes-deploy-test-'))
  const home = join(root, 'home')
  const bundle = join(root, 'bundle')
  const script = resolve(import.meta.dirname, '../scripts/deploy-local.mjs')
  mkdirSync(join(bundle, 'api', 'dist', 'db'), { recursive: true })
  mkdirSync(join(bundle, 'deploy', 'windows'), { recursive: true })
  writeFileSync(join(bundle, '.env.example'), 'SEED_DEV_ACCOUNTS=true\nFILE_STORAGE_ROOT=./storage\nAPP_ORIGIN=http://127.0.0.1:3000\n')
  writeFileSync(join(bundle, 'deploy', 'windows', 'mes-hub.xml'), '<service/>')
  writeFileSync(join(bundle, 'api', 'dist', 'main.js'), 'old')
  writeFileSync(join(bundle, 'api', 'dist', 'db', 'migrate.js'), 'import { writeFileSync } from "node:fs"; writeFileSync("migrated", "yes")')
  const run = (...args) => spawnSync(process.execPath, [script, '--home', home, '--bundle', bundle, ...args], { encoding: 'utf8' })
  try {
    let result = run('--init')
    assert.equal(result.status, 0, result.stderr)
    assert.ok(existsSync(join(home, 'service', 'mes-hub.xml')))
    assert.ok(existsSync(join(home, 'storage')))
    assert.ok(existsSync(join(home, 'logs')))
    assert.ok(existsSync(join(home, 'backups')))
    assert.match(readFileSync(join(home, 'config', '.env'), 'utf8'), /SEED_DEV_ACCOUNTS=false/)
    assert.match(readFileSync(join(home, 'config', '.env'), 'utf8'), /FILE_STORAGE_ROOT=.*storage/)
    assert.equal(existsSync(join(home, 'app')), false)
    writeFileSync(join(home, 'config', '.env'), 'KEEP_SECRET=preserved\n')
    result = run('--dry-run')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(join(home, 'app')), false)
    result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(join(home, 'app', 'api', 'dist', 'main.js'), 'utf8'), 'old')
    writeFileSync(join(bundle, 'api', 'dist', 'main.js'), 'new')
    result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(join(home, 'app', 'api', 'dist', 'main.js'), 'utf8'), 'new')
    assert.equal(readFileSync(join(home, 'config', '.env'), 'utf8'), 'KEEP_SECRET=preserved\n')
    assert.ok(existsSync(join(home, 'app', 'migrated')))
    assert.equal(readdirSync(join(home, 'backups')).length, 1)
    result = run('--rollback')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(join(home, 'app', 'api', 'dist', 'main.js'), 'utf8'), 'old')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
