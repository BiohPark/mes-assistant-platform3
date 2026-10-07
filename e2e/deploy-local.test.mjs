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
    assert.match(result.stdout, /DB.*복원.*--start/)
    assert.doesNotMatch(result.stdout, /서비스 start/)
    result = run('--start', '--no-service')
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /서비스 start 생략/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('failed bundle copy or validation leaves the current app and rollback backups intact', () => {
  const root = mkdtempSync(join(tmpdir(), 'mes-deploy-copy-test-'))
  const home = join(root, 'home')
  const bundle = join(root, 'bundle')
  const script = resolve(import.meta.dirname, '../scripts/deploy-local.mjs')
  const hook = join(root, 'fail-copy.mjs')
  mkdirSync(join(bundle, 'api', 'dist', 'db'), { recursive: true })
  mkdirSync(join(bundle, 'deploy', 'windows'), { recursive: true })
  mkdirSync(join(home, 'config'), { recursive: true })
  writeFileSync(join(home, 'config', '.env'), 'KEEP_SECRET=preserved\n')
  writeFileSync(join(bundle, '.env.example'), 'APP_ORIGIN=http://127.0.0.1:3000\n')
  writeFileSync(join(bundle, 'deploy', 'windows', 'mes-hub.xml'), '<service/>')
  writeFileSync(join(bundle, 'api', 'dist', 'main.js'), 'old')
  writeFileSync(join(bundle, 'api', 'dist', 'db', 'migrate.js'), '')
  writeFileSync(hook, `import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
const copy = fs.cpSync
fs.cpSync = (source, destination, options) => {
  if (source !== process.env.MES_TEST_BUNDLE) return copy(source, destination, options)
  if (process.env.MES_TEST_COPY_MODE === 'partial') {
    fs.mkdirSync(destination, { recursive: true })
    fs.writeFileSync(join(destination, 'partial'), 'incomplete')
    throw new Error('simulated copy failure')
  }
  copy(source, destination, options)
  fs.rmSync(join(destination, 'api', 'dist', 'main.js'))
}
syncBuiltinESMExports()
`)
  const run = (mode) => spawnSync(process.execPath, [...(mode ? ['--import', hook] : []), script, '--home', home, '--bundle', bundle, '--no-service'], {
    encoding: 'utf8', env: { ...process.env, MES_TEST_BUNDLE: bundle, MES_TEST_COPY_MODE: mode },
  })
  try {
    let result = run()
    assert.equal(result.status, 0, result.stderr)
    writeFileSync(join(bundle, 'api', 'dist', 'main.js'), 'new')
    for (const mode of ['partial', 'incomplete']) {
      result = run(mode)
      assert.notEqual(result.status, 0)
      assert.equal(readFileSync(join(home, 'app', 'api', 'dist', 'main.js'), 'utf8'), 'old')
      assert.deepEqual(readdirSync(join(home, 'backups')), [])
      assert.equal(readdirSync(home).some((name) => name.startsWith('app-staging-')), false)
    }
    result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(join(home, 'app', 'api', 'dist', 'main.js'), 'utf8'), 'new')
    assert.equal(readdirSync(join(home, 'backups')).filter((name) => /^app-\d/.test(name)).length, 1)
    result = spawnSync(process.execPath, [script, '--home', home, '--rollback', '--no-service'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(join(home, 'app', 'api', 'dist', 'main.js'), 'utf8'), 'old')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
