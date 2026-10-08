import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('U7 이후 native select는 U9의 SR 상태 하나만 남는다', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const files = readdirSync(root, { recursive: true }).map(String).filter(file => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
  const selects = files.flatMap(file => [...readFileSync(path.join(root, file), 'utf8').matchAll(/<select\b[^>]*>/g)].map(match => ({ file, tag: match[0] })))
  expect(selects).toHaveLength(1)
  expect(selects[0]?.file).toBe('features/sr/SrDetailSheet.tsx')
  expect(selects[0]?.tag).toContain('aria-label="SR 상태"')
})
