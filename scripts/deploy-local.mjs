import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
function value(flag) { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1] }
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} 실패 (${result.status})`)
}
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-') }
function verifyCopy(source, destination) {
  const before = lstatSync(source)
  const after = lstatSync(destination)
  if (before.isDirectory() !== after.isDirectory() || before.isFile() !== after.isFile() || before.isSymbolicLink() !== after.isSymbolicLink()) {
    throw new Error(`배포 묶음 복사 검증 실패: ${source}`)
  }
  if (before.isDirectory()) {
    const names = readdirSync(source).sort()
    if (JSON.stringify(names) !== JSON.stringify(readdirSync(destination).sort())) throw new Error(`배포 묶음 복사 검증 실패: ${source}`)
    for (const name of names) verifyCopy(join(source, name), join(destination, name))
  } else if (before.isFile() && before.size !== after.size) {
    throw new Error(`배포 묶음 복사 검증 실패: ${source}`)
  }
}
function service(home, action, disabled) {
  const exe = join(home, 'service', 'mes-hub.exe')
  if (disabled) { console.log(`서비스 ${action} 생략 (--no-service)`); return false }
  if (!existsSync(exe)) { console.log(`서비스 ${action} 생략: ${exe} 없음`); return false }
  run(exe, [action], { cwd: join(home, 'service') })
  return true
}
async function health(home) {
  const env = readFileSync(join(home, 'config', '.env'), 'utf8')
  const origin = env.match(/^APP_ORIGIN=(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  if (!origin) throw new Error('config/.env에 APP_ORIGIN이 필요합니다')
  const response = await fetch(new URL('/api/health', origin), { signal: AbortSignal.timeout(15000) })
  if (!response.ok || (await response.json()).status !== 'ok') throw new Error(`/api/health 확인 실패 (${response.status})`)
  console.log('/api/health 확인 완료')
}

const homeArg = value('--home')
if (!homeArg || !isAbsolute(homeArg)) throw new Error('--home에 절대 경로가 필요합니다')
const home = resolve(homeArg)
const bundle = resolve(value('--bundle') ?? join(repo, 'release', 'mes-hub'))
const app = join(home, 'app')
const backups = join(home, 'backups')
const noService = args.includes('--no-service')
const dryRun = args.includes('--dry-run')
const init = args.includes('--init')
const rollback = args.includes('--rollback')
const start = args.includes('--start')
if ([init, rollback, start].filter(Boolean).length > 1) throw new Error('--init, --rollback, --start는 함께 쓸 수 없습니다')
if (bundle === app || home === repo || home.startsWith(`${repo}/`)) throw new Error('운영 HOME은 저장소 밖이어야 합니다')

if (dryRun) {
  console.log(`예정: ${init ? 'config/service/storage/logs/backups 초기 구조 생성' : rollback ? '서비스 중지 → 최근 app 백업 복원 → DB 복원 안내 (--start 별도)' : start ? '서비스 시작 → 상태 확인' : 'release 빌드 → 새 app 임시 복사·검증 → 서비스 중지 → app 백업·교체 → DB 마이그레이션 → 서비스 시작 → 상태 확인'}`)
  console.log(`HOME: ${home}`)
  console.log(`설정 유지: ${join(home, 'config', '.env')}`)
  process.exit(0)
}

if (rollback) {
  const latest = existsSync(backups) ? readdirSync(backups).filter((name) => /^app-\d/.test(name)).sort().at(-1) : undefined
  if (!latest) throw new Error('되돌릴 app 백업이 없습니다')
  service(home, 'stop', noService)
  if (existsSync(app)) renameSync(app, join(backups, `failed-${stamp()}`))
  renameSync(join(backups, latest), app)
  console.log('DB는 자동으로 되돌리지 않습니다. 필요한 경우 별도 DB 백업을 복원한 뒤 --start로 서비스를 시작하세요.')
  process.exit(0)
}

if (start) {
  if (!existsSync(app)) throw new Error('시작할 app이 없습니다')
  if (service(home, 'start', noService)) await health(home)
  process.exit(0)
}

if (init) {
  if (existsSync(app) || existsSync(join(home, 'config', '.env')) || existsSync(join(home, 'service', 'mes-hub.xml'))) {
    throw new Error('기존 app/config/service가 있어 --init으로 덮어쓸 수 없습니다')
  }
  const template = value('--bundle') ? bundle : repo
  for (const dir of ['config', 'service', 'storage', 'logs', 'backups']) mkdirSync(join(home, dir), { recursive: true })
  let env = readFileSync(join(template, '.env.example'), 'utf8')
  env = env.replace(/^SEED_DEV_ACCOUNTS=.*$/m, 'SEED_DEV_ACCOUNTS=false').replace(/^FILE_STORAGE_ROOT=.*$/m, `FILE_STORAGE_ROOT=${join(home, 'storage')}`)
  env += '\nNODE_ENV=production\n'
  writeFileSync(join(home, 'config', '.env'), env, { flag: 'wx', mode: 0o600 })
  const xml = value('--bundle') ? join(template, 'deploy', 'windows', 'mes-hub.xml') : join(repo, 'deploy', 'windows', 'mes-hub.xml')
  cpSync(xml, join(home, 'service', 'mes-hub.xml'), { errorOnExist: true, force: false })
  console.log(`초기 구조 생성: ${home}. config/.env를 설정한 뒤 업데이트 명령을 실행하세요.`)
  process.exit(0)
}

if (!value('--bundle')) {
  const pnpm = process.env.npm_execpath
  if (pnpm) run(process.execPath, [pnpm, 'release'], { cwd: repo })
  else run('pnpm', ['release'], { cwd: repo })
}
for (const path of ['api/dist/main.js', 'api/dist/db/migrate.js', '.env.example', 'deploy/windows/mes-hub.xml']) {
  if (!existsSync(join(bundle, path))) throw new Error(`배포 묶음 누락: ${path}`)
}
for (const dir of ['config', 'service', 'storage', 'logs', 'backups']) mkdirSync(join(home, dir), { recursive: true })
if (!existsSync(join(home, 'config', '.env'))) throw new Error('config/.env가 없습니다. 먼저 --init을 실행하세요')
const staged = mkdtempSync(join(home, 'app-staging-'))
try {
  cpSync(bundle, staged, { recursive: true })
  verifyCopy(bundle, staged)
  for (const path of ['api/dist/main.js', 'api/dist/db/migrate.js', '.env.example', 'deploy/windows/mes-hub.xml']) {
    if (!existsSync(join(staged, path))) throw new Error(`배포 묶음 복사 검증 실패: ${path}`)
  }
  service(home, 'stop', noService)
  if (existsSync(app)) renameSync(app, join(backups, `app-${stamp()}`))
  renameSync(staged, app)
} finally { rmSync(staged, { recursive: true, force: true }) }
run(process.execPath, ['--env-file', join(home, 'config', '.env'), join(app, 'api', 'dist', 'db', 'migrate.js')], { cwd: app })
if (service(home, 'start', noService)) await health(home)
console.log(`배포 완료: ${app}`)
