import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

test('HOME inside the repository is rejected before release builds on native and Windows paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'mes-deploy-path-test-'))
  const script = resolve(import.meta.dirname, '../scripts/deploy-local.mjs')
  const repo = resolve(import.meta.dirname, '..')
  const hook = join(root, 'paths.mjs')
  const built = join(root, 'built')
  writeFileSync(hook, `import path from 'node:path'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import { writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
const nativeSep = path.sep
if (process.env.MES_TEST_WINDOWS === 'yes') {
  const native = { ...path }
  const windows = { ...path.win32 }
  path.resolve = (...parts) => parts[0] === process.env.MES_TEST_SCRIPT_DIR
    ? 'C:\\\\repo' : (parts[0]?.startsWith('/') ? native : windows).resolve(...parts)
  path.join = (...parts) => (parts[0]?.startsWith('/') ? native : windows).join(...parts)
  path.relative = (from, to) => (from.startsWith('/') ? native : windows).relative(from, to)
  path.isAbsolute = (input) => native.isAbsolute(input) || windows.isAbsolute(input)
  path.sep = windows.sep
}
childProcess.spawnSync = () => {
  writeFileSync(process.env.MES_TEST_BUILT, 'release invoked')
  throw new Error('unexpected release build')
}
fs.mkdirSync = () => { throw new Error('unexpected HOME write') }
syncBuiltinESMExports()
path.sep = nativeSep
`)
  const run = (home, windows, ...args) => spawnSync(process.execPath, ['--import', hook, script, '--home', home, ...args], {
    encoding: 'utf8', env: { ...process.env, MES_TEST_WINDOWS: windows ? 'yes' : 'no', MES_TEST_SCRIPT_DIR: resolve(repo, 'scripts'), MES_TEST_BUILT: built },
  })
  try {
    const nativeHomes = [repo, join(repo, 'release', 'mes-hub'), join(repo, 'release', 'mes-hub', 'home')]
    if (process.platform !== 'win32') nativeHomes.push(join(repo, '..\\home'))
    for (const home of nativeHomes) {
      const result = run(home, false)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /운영 HOME은 저장소 밖이어야 합니다/)
      assert.equal(existsSync(built), false)
    }
    for (const home of ['C:\\repo', 'C:\\repo\\release\\mes-hub', 'C:\\repo\\release\\mes-hub\\home', 'c:\\REPO\\release\\..\\home', 'C:/repo/release/mes-hub']) {
      const result = run(home, true)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /운영 HOME은 저장소 밖이어야 합니다/)
      assert.equal(existsSync(built), false)
    }
    for (const home of ['C:\\repo-other', 'C:\\repo\\..\\home', 'D:\\mes-hub', '\\\\server\\share\\mes-hub']) {
      const result = run(home, true, '--dry-run')
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /HOME:/)
      assert.equal(existsSync(built), false)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('migration failure, retry and rollback restore V1 and exclude the failed app', () => {
  const root = mkdtempSync(join(tmpdir(), 'mes-deploy-retry-test-'))
  const home = join(root, 'home')
  const bundle = join(root, 'bundle')
  const script = resolve(import.meta.dirname, '../scripts/deploy-local.mjs')
  mkdirSync(join(bundle, 'api', 'dist', 'db'), { recursive: true })
  mkdirSync(join(bundle, 'deploy', 'windows'), { recursive: true })
  mkdirSync(join(home, 'config'), { recursive: true })
  writeFileSync(join(home, 'config', '.env'), 'KEEP_SECRET=preserved\n')
  writeFileSync(join(bundle, '.env.example'), 'APP_ORIGIN=http://127.0.0.1:3000\n')
  writeFileSync(join(bundle, 'deploy', 'windows', 'mes-hub.xml'), '<service/>')
  writeFileSync(join(bundle, 'api', 'dist', 'main.js'), 'V1')
  const migration = join(bundle, 'api', 'dist', 'db', 'migrate.js')
  const checkStarted = `import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const state = JSON.parse(readFileSync('../deployment-state.json', 'utf8'));
assert.equal(state.status, 'started'); assert.equal(state.appStatus, 'started');`
  writeFileSync(migration, checkStarted)
  const run = (...args) => spawnSync(process.execPath, [script, '--home', home, '--bundle', bundle, '--no-service', ...args], { encoding: 'utf8' })
  const state = () => JSON.parse(readFileSync(join(home, 'deployment-state.json'), 'utf8'))
  try {
    let result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(state().status, 'succeeded')
    assert.equal(state().appStatus, 'succeeded')
    assert.equal(state().rollbackBackup, null)
    assert.ok(Number.isFinite(Date.parse(state().startedAt)))
    assert.ok(Number.isFinite(Date.parse(state().finishedAt)))
    writeFileSync(join(bundle, 'api', 'dist', 'main.js'), 'V2')
    writeFileSync(migration, `${checkStarted}\nprocess.exit(1)`)
    result = run()
    assert.notEqual(result.status, 0)
    assert.equal(state().status, 'failed')
    assert.equal(state().appStatus, 'failed')
    assert.ok(Number.isFinite(Date.parse(state().finishedAt)))
    assert.equal(readFileSync(join(home, 'app', 'api', 'dist', 'main.js'), 'utf8'), 'V2')
    const goodBackup = state().rollbackBackup
    assert.match(goodBackup, /^app-\d/)
    assert.equal(readFileSync(join(home, 'backups', goodBackup, 'api', 'dist', 'main.js'), 'utf8'), 'V1')
    writeFileSync(migration, checkStarted)
    result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(state().status, 'succeeded')
    assert.equal(state().appStatus, 'succeeded')
    assert.equal(state().rollbackBackup, goodBackup)
    const backups = readdirSync(join(home, 'backups'))
    assert.deepEqual(backups.filter((name) => /^app-\d/.test(name)), [goodBackup])
    const failed = backups.filter((name) => /^failed-\d/.test(name))
    assert.equal(failed.length, 1)
    assert.equal(readFileSync(join(home, 'backups', failed[0], 'api', 'dist', 'main.js'), 'utf8'), 'V2')
    // An untracked, newer app backup must not override the recorded successful app.
    mkdirSync(join(home, 'backups', 'app-9999-01-01T00-00-00-000Z'))
    result = run('--rollback')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(join(home, 'app', 'api', 'dist', 'main.js'), 'utf8'), 'V1')
    assert.equal(state().appStatus, 'succeeded')
    assert.equal(state().rollbackBackup, null)
    assert.equal(readFileSync(join(home, 'config', '.env'), 'utf8'), 'KEEP_SECRET=preserved\n')
    assert.match(result.stdout, /DB.*복원.*--start/)
    assert.doesNotMatch(result.stdout, /서비스 start/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

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
      const state = JSON.parse(readFileSync(join(home, 'deployment-state.json'), 'utf8'))
      assert.equal(state.status, 'failed')
      assert.equal(state.appStatus, 'succeeded')
      assert.equal(state.rollbackBackup, null)
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
