// 설치 가이드의 ```powershell ci 블록을 그대로 실행한다 — 문서와 실제가 어긋나지 않게 (CI windows 잡).
// 사용: node scripts/run-doc-commands.mjs docs/setup/windows.md [--list]
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [docPath, flag] = process.argv.slice(2)
if (!docPath) {
  console.error('사용: node scripts/run-doc-commands.mjs <문서.md> [--list]')
  process.exit(2)
}

const root = resolve(import.meta.dirname, '..')
const lines = readFileSync(resolve(root, docPath), 'utf8').split(/\r?\n/)
const blocks = []
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() !== '```powershell ci') continue
  const body = []
  for (i++; i < lines.length && lines[i].trim() !== '```'; i++) body.push(lines[i])
  blocks.push({ line: blocks.length + 1, body: body.join('\n') })
}
if (blocks.length === 0) {
  console.error(`${docPath}: \`\`\`powershell ci 블록이 없습니다`)
  process.exit(2)
}

if (flag === '--list') {
  for (const b of blocks) console.log(`# --- 블록 ${b.line}\n${b.body}`)
  process.exit(0)
}

// 네이티브 명령(pnpm·mariadb·git)의 실패도 즉시 중단 (PowerShell 7.3+)
const script = [
  "$ErrorActionPreference = 'Stop'",
  '$PSNativeCommandUseErrorActionPreference = $true',
  `Set-Location -LiteralPath '${root.replaceAll("'", "''")}'`,
  ...blocks.map((b) => `Write-Host '::group::문서 블록 ${b.line}'\n${b.body}\nWrite-Host '::endgroup::'`),
].join('\n')

const file = join(mkdtempSync(join(tmpdir(), 'doc-commands-')), 'run.ps1')
writeFileSync(file, script, 'utf8')
const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', file], { stdio: 'inherit' })
if (result.error) {
  console.error(`pwsh 실행 실패: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
