import { describe, expect, it } from 'vitest'
import { LlmModelsSchema, LlmStatusSchema } from './llm.js'

describe('LLM 응답 계약', () => {
  it('모델 ID 목록과 공개 가능한 상태 필드만 검증한다', () => {
    expect(LlmModelsSchema.parse({ models: ['fake-general'] })).toEqual({ models: ['fake-general'] })
    expect(LlmStatusSchema.parse({ mode: 'live', preset: 'openwebui', baseUrlHost: 'localhost:3101', ok: true, detail: '연결 성공' }).ok).toBe(true)
    expect(LlmModelsSchema.safeParse({ models: [123] }).success).toBe(false)
    expect(LlmStatusSchema.safeParse({ mode: 'live', preset: 'other', baseUrlHost: '', ok: false, detail: '' }).success).toBe(false)
  })
})
