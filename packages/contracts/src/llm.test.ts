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

  it('허용 목록 밖 값(키·주소·파일명·본문)은 통과하지 못한다 — 리뷰 P1 ×4', () => {
    const attempt = { mode: 'legacy', status: 400, firstByteMs: null, firstContentMs: null, totalMs: 2, frames: ['기타+sources', 'choices.delta.기타+choices.delta.content ×3', '[DONE]'], error: 'HTTP 400 · 형식 거부' }
    const meta = { found: true, toolIds: ['web_tool', 'server:mcp:docs', '(가림)'], defaultFeatureIds: ['web_search'], capabilities: { vision: true }, knowledgeCount: 1, functionCalling: '기타' }
    const ok = { model: 'm', version: '0.12.0', ms: 3, attempts: [attempt], meta }
    expect(OwuiProbeResultSchema.safeParse(ok).success).toBe(true)
    const bad = [
      { ...ok, meta: { ...meta, capabilities: { 'sk-live-secret': true } } },
      { ...ok, attempts: [{ ...attempt, frames: ['confidential_answer'] }] },
      { ...ok, attempts: [{ ...attempt, frames: ['choices.delta.confidential_answer'] }] },
      { ...ok, meta: { ...meta, toolIds: ['10.20.30.40'] } },
      { ...ok, meta: { ...meta, defaultFeatureIds: ['private-report.pdf'] } },
      { ...ok, attempts: [{ ...attempt, error: 'HTTP 400 · Cookie: sid=1' }] },
      { ...ok, meta: { ...meta, error: 'HTTP 401 · bad key' } },
      { ...ok, meta: { ...meta, functionCalling: 'sk-live-secret' } },
      { ...ok, version: 'owui.corp.example' },
    ]
    for (const value of bad) expect(OwuiProbeResultSchema.safeParse(value).success).toBe(false)
  })
})
