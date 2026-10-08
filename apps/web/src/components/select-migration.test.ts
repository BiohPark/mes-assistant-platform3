import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('U9 이후 native select는 남지 않는다 (SR 상태는 전이 버튼으로)', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const files = readdirSync(root, { recursive: true }).map(file => String(file).split(path.sep).join('/')).filter(file => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
  const selects = files.flatMap(file => [...readFileSync(path.join(root, file), 'utf8').matchAll(/<select\b[^>]*>/g)].map(match => ({ file, tag: match[0] })))
  expect(selects).toEqual([])
})
