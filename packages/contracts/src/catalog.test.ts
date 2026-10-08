import { describe, expect, it } from 'vitest'
import { AssistantSchema, AssistantStatsSchema, CodeSchema, CatalogUserSchema } from './catalog.js'

describe('catalog contracts', () => {
  it('accepts a labeled assistant with code references and nested guidance', () => {
    expect(AssistantSchema.parse({
      id: 'a', name: '도우미', level1: 'SDLC', level2: '분석', level1CodeId: 'assistant_level1:SDLC',
      level2CodeId: 'assistant_level2:analysis', summary: '', order: 1, expectedInputs: ['문서'],
      expectedOutputs: [], ownerId: 'seed-system', status: 'open', usageExample: '', color: '#2563eb',
      checklistTemplate: [{ id: 'ct-a-1', label: '확인', required: true }], createdBy: 'seed-system',
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', revision: 0,
    }).level1).toBe('SDLC')
  })

  it('requires catalog stats, users and codes in their API shapes', () => {
    expect(AssistantStatsSchema.parse({ assistantId: 'a', open: 0, inProgress: 0, onHold: 0, done: 0 }).done).toBe(0)
    expect(CatalogUserSchema.parse({ id: 'u', name: '사용자', initials: '사', color: '#123456', isSystemOwner: false, isBusinessOwner: true }).isBusinessOwner).toBe(true)
    expect(CodeSchema.parse({ id: 'assistant_level1:SDLC', groupKey: 'assistant_level1', code: 'SDLC', name: 'SDLC', sortOrder: 0, active: true }).code).toBe('SDLC')
  })
})

it('자동 코드 메타데이터를 보존하고 전환 기간 응답은 수동 코드로 해석한다', () => {
  const legacy = { id: 'c', groupKey: 'assistant_level1', code: 'c', name: '분류', sortOrder: 0, active: true }
  expect(CodeSchema.parse(legacy).isAuto).toBe(false)
  expect(CodeSchema.parse({ ...legacy, isAuto: true }).isAuto).toBe(true)
  expect(CodeSchema.safeParse({ ...legacy, isAuto: 'true' }).success).toBe(false)
})
