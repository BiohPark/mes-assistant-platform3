import { expect, it, vi } from 'vitest'
import { newId } from './ids'

it('randomUUID가 없는 브라우저에서도 UUID v4를 만든다', () => {
  const original = globalThis.crypto
  vi.stubGlobal('crypto', { getRandomValues: original.getRandomValues.bind(original) })
  try {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  } finally { vi.unstubAllGlobals() }
})

it('웹 소스는 도우미 밖에서 randomUUID를 직접 호출하지 않는다', () => {
  const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  expect(Object.entries(sources).filter(([path, source]) => !path.endsWith('ids.test.ts') && !path.endsWith('lib/ids.ts') && /crypto\.randomUUID\s*\(/.test(source)).map(([path]) => path)).toEqual([])
})
