import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim() || 'unknown'
writeFileSync(join(root, 'apps', 'api', 'dist', 'build-info.json'), JSON.stringify({ version, commit, builtAt: new Date().toISOString() }))
rmSync(bundle, { recursive: true, force: true })
mkdirSync(join(root, 'release'), { recursive: true })
writeFileSync(join(root, 'release', '.gitignore'), '*\n')
mkdirSync(bundle, { recursive: true })
run(['--config.node-linker=hoisted', '--filter', '@mes/api', 'deploy', '--prod', '--legacy', join(bundle, 'api')])
cpSync(join(root, 'apps', 'web', 'dist'), join(bundle, 'web', 'dist'), { recursive: true })
cpSync(join(root, 'apps', 'api', 'drizzle'), join(bundle, 'api', 'drizzle'), { recursive: true })
cpSync(join(root, 'deploy', 'windows'), join(bundle, 'deploy', 'windows'), { recursive: true })
cpSync(join(root, '.env.example'), join(bundle, '.env.example'))
for (const name of ['contracts', 'domain', 'llm']) {
  const workspacePackage = join(bundle, 'api', 'node_modules', '@mes', name)
  for (const entry of readdirSync(workspacePackage)) {
    if (entry !== 'dist' && entry !== 'package.json') rmSync(join(workspacePackage, entry), { recursive: true, force: true })
  }
}
for (const name of ['seed.js', 'seed.js.map', 'seed.d.ts', 'seedData.js', 'seedData.js.map', 'seedData.d.ts']) {
  rmSync(join(bundle, 'api', 'dist', 'db', name), { force: true })
}
for (const parts of [['api', 'dist', 'main.js'], ['api', 'dist', 'build-info.json'], ['api', 'dist', 'db', 'migrate.js'], ['web', 'dist', 'index.html'], ['deploy', 'windows', 'mes-hub.xml']]) {
  if (!existsSync(join(bundle, ...parts))) throw new Error(`배포 묶음 누락: ${join(...parts)}`)
}
for (const parts of [['api', 'src'], ['api', 'storage'], ['api', 'vitest.config.ts']]) {
  if (existsSync(join(bundle, ...parts))) throw new Error(`배포 묶음에 불필요한 파일: ${join(...parts)}`)
}
console.log(`배포 묶음 생성: ${bundle}`)
