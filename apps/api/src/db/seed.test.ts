import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

it('setup-env는 예시 파일의 개발 계정 플래그를 그대로 복사한다', () => {
  const root = mkdtempSync(join(tmpdir(), 'mes-setup-env-'))
  try {
    mkdirSync(join(root, 'scripts'))
    const script = join(root, 'scripts', 'setup-env.mjs')
    copyFileSync(resolve(import.meta.dirname, '../../../../scripts/setup-env.mjs'), script)
    writeFileSync(join(root, '.env.example'), 'SEED_DEV_ACCOUNTS=false\n')
    execFileSync(process.execPath, [script])
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('SEED_DEV_ACCOUNTS=false\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
