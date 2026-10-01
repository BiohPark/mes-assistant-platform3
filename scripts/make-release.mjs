import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const bundle = join(root, 'release', 'mes-hub')
const pnpm = process.env.npm_execpath
if (!pnpm) throw new Error('pnpm release로 실행해야 합니다')

function run(args) {
  const result = spawnSync(process.execPath, [pnpm, ...args], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} 실패 (${result.status})`)
}

run(['build'])
rmSync(bundle, { recursive: true, force: true })
mkdirSync(join(root, 'release'), { recursive: true })
writeFileSync(join(root, 'release', '.gitignore'), '*\n')
mkdirSync(bundle, { recursive: true })
run(['--filter', '@mes/api', 'deploy', '--prod', '--legacy', join(bundle, 'api')])
cpSync(join(root, 'apps', 'web', 'dist'), join(bundle, 'web', 'dist'), { recursive: true })
cpSync(join(root, 'apps', 'api', 'drizzle'), join(bundle, 'api', 'drizzle'), { recursive: true })
cpSync(join(root, 'deploy', 'windows'), join(bundle, 'deploy', 'windows'), { recursive: true })
cpSync(join(root, '.env.example'), join(bundle, '.env.example'))
for (const path of ['api/dist/main.js', 'api/dist/db/migrate.js', 'web/dist/index.html', 'deploy/windows/mes-hub.xml']) {
  if (!existsSync(join(bundle, path))) throw new Error(`배포 묶음 누락: ${path}`)
}
for (const path of ['api/src', 'api/storage', 'api/vitest.config.ts']) {
  if (existsSync(join(bundle, path))) throw new Error(`배포 묶음에 불필요한 파일: ${path}`)
}
console.log(`배포 묶음 생성: ${bundle}`)
