import { describe, expect, it } from 'vitest'
import { LlmModelsSchema, LlmStatusSchema, OwuiProbeRequestSchema, OwuiProbeResultSchema } from './llm.js'

describe('LLM 응답 계약', () => {
  it('모델 ID 목록과 공개 가능한 상태 필드만 검증한다', () => {
    expect(LlmModelsSchema.parse({ models: ['fake-general'] })).toEqual({ models: ['fake-general'] })
    expect(LlmStatusSchema.parse({ mode: 'live', preset: 'openwebui', baseUrlHost: 'localhost:3101', ok: true, detail: '연결 성공' }).ok).toBe(true)
    expect(LlmModelsSchema.safeParse({ models: [123] }).success).toBe(false)
    expect(LlmStatusSchema.safeParse({ mode: 'live', preset: 'other', baseUrlHost: '', ok: false, detail: '' }).success).toBe(false)
  })
})

describe('OpenWebUI 진단 계약', () => {
  it('요청은 모델 하나만, 결과는 알려진 필드만 남긴다', () => {
    expect(OwuiProbeRequestSchema.parse({ model: ' m ' })).toEqual({ model: 'm' })
    for (const body of [{}, { model: '' }, { model: 'm', prompt: 'x' }]) expect(OwuiProbeRequestSchema.safeParse(body).success).toBe(false)
    const attempt = { mode: 'current', status: 200, firstByteMs: 1, firstContentMs: null, totalMs: 2, frames: ['choices.delta.content'] }
    const parsed = OwuiProbeResultSchema.parse({ model: 'm', version: null, ms: 3, leaked: 'x', attempts: [attempt],
      meta: { found: false, toolIds: [], defaultFeatureIds: [], capabilities: {}, knowledgeCount: 0, functionCalling: null } })
    expect(parsed).not.toHaveProperty('leaked')
    expect(OwuiProbeResultSchema.safeParse({ ...parsed, attempts: [{ ...attempt, error: 'x'.repeat(121) }] }).success).toBe(false)
  })
})
