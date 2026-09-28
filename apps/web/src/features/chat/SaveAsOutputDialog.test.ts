import { expect, it } from 'vitest'
import { defaultOutputName } from './SaveAsOutputDialog'

it('uses the most recent output name so saving again creates a new version', () => {
  expect(defaultOutputName([
    { name: 'first.md', source: 'assistant', uploadedAt: '2026-01-01T00:00:00.000Z' },
    { name: 'recent.md', source: 'assistant', uploadedAt: '2026-01-02T00:00:00.000Z' },
  ], '분석', 'WK-2026-0001')).toBe('recent.md')
  expect(defaultOutputName([], '분석 단계', 'WK-2026-0001')).toBe('분석단계_WK-2026-0001.md')
  expect(defaultOutputName([
    { name: 'assistant.md', source: 'assistant', uploadedAt: '2026-01-01T00:00:00.000Z' },
    { name: 'manual.md', source: 'upload', isOutput: true, uploadedAt: '2026-01-03T00:00:00.000Z' },
  ], '분석', 'WK-2026-0001')).toBe('manual.md')
})
