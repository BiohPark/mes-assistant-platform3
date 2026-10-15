import { describe, expect, it } from 'vitest'
import { LlmModelsSchema, LlmStatusSchema, OwuiAccessCheckSchema, OwuiProbeRequestSchema, OwuiProbeResultSchema } from './llm.js'

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
      meta: { found: false, toolIds: [], defaultFeatureIds: [], capabilities: {}, builtinTools: {}, terminal: false, knowledgeCount: 0, functionCalling: null },
      access: { tools: { visible: null, items: [] }, skills: { visible: null, items: [] } }, account: { role: null, features: { web_search: null, image_generation: null, code_interpreter: null } },
      fetchUrl: [{ name: 'session_id', ok: null }], session: { status: null, firstStatusMs: null, doneMs: null, totalMs: 0, statuses: [], cleanup: null } })
    expect(parsed).not.toHaveProperty('leaked')
    expect(OwuiProbeResultSchema.safeParse({ ...parsed, attempts: [{ ...attempt, error: 'x'.repeat(121) }] }).success).toBe(false)
  })

  it('허용 목록 밖 값(키·주소·파일명·본문)은 통과하지 못한다 — 리뷰 P1 ×4', () => {
    const attempt = { mode: 'legacy', status: 400, firstByteMs: null, firstContentMs: null, totalMs: 2, frames: ['기타+sources', 'choices.delta.기타+choices.delta.content ×3', '[DONE]'], error: 'HTTP 400 · 형식 거부' }
    const meta = { found: true, toolIds: ['web_tool', 'server:mcp:docs', '(가림)'], defaultFeatureIds: ['web_search'], capabilities: { vision: true, terminal: false }, builtinTools: { skills: false }, terminal: true, knowledgeCount: 1, functionCalling: '기타' }
    const access = { tools: { visible: 3, items: [{ id: 'web_tool', state: 'ok' }, { id: '(가림)', state: 'denied' }] }, skills: { visible: null, items: [{ id: 'skill_a', state: 'unknown' }], error: 'HTTP 404 · 찾을 수 없음' } }
    const session = { status: 200, firstStatusMs: 10, doneMs: 20, totalMs: 30, statuses: ['web_search ×2', '기타', 'tool_connection!', '…'], cleanup: true, error: '작업 실패' }
    const account = { role: 'user', features: { web_search: false, image_generation: true, code_interpreter: null }, error: 'HTTP 403 · 인증 거부' }
    const fetchUrl = [{ name: 'session_id', ok: true }, { name: 'web.search.enable', ok: null }, { name: 'permission.web_search', ok: false }]
    const ok = { model: 'm', version: '0.12.0', ms: 3, attempts: [attempt], meta, access, account, fetchUrl, session }
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
      // 재리뷰 P1·P2
      { ...ok, version: '10.20.30.40' },
      { ...ok, model: 'http://evil.example/x?q=secret' },
      { ...ok, model: 'C:/private/path' },
      { ...ok, model: 'sk-model-secret' },
      { ...ok, meta: { ...meta, toolIds: ['sk-proj-abc'] } },
      { ...ok, meta: { ...meta, toolIds: ['a1b2c3d4e5f6g7h8i9j0k1l2'] } },
      { ...ok, meta: { ...meta, defaultFeatureIds: ['ghp_abcdef'] } },
      // S13-J 도구·스킬 접근·세션 시험
      { ...ok, meta: { ...meta, builtinTools: { 'evil.example': true } } },
      { ...ok, meta: { ...meta, terminal: 'term-corp-1' } },
      { ...ok, access: { ...access, tools: { visible: 1, items: [{ id: 'private-report.pdf', state: 'ok' }] } } },
      { ...ok, access: { ...access, skills: { visible: 1, items: [{ id: 'sk-live-secret', state: 'ok' }] } } },
      { ...ok, access: { ...access, skills: { visible: 1, items: [{ id: 'skill_a', state: 'maybe' }] } } },
      { ...ok, access: { ...access, tools: { visible: null, items: [], error: 'HTTP 403 · API key not allowed' } } },
      { ...ok, session: { ...session, statuses: ['Searching http://corp.example'] } },
      { ...ok, session: { ...session, statuses: ['URL 읽는 중'] } },
      { ...ok, session: { ...session, statuses: ['sk_live_abc'] } },
      { ...ok, session: { ...session, error: '가짜 OpenWebUI 오류' } },
      { ...ok, session: { ...session, cleanup: 'yes' } },
      // 서비스 계정 — 역할·불린만
      { ...ok, account: { ...account, role: 'svc@corp.example' } },
      { ...ok, account: { ...account, features: { ...account.features, web_search: 'owui-user-7f3a' } } },
      { ...ok, account: { ...account, error: 'HTTP 401 · svc@corp.example' } },
      { ...ok, fetchUrl: [{ name: 'svc@corp.example', ok: true }] },
      { ...ok, fetchUrl: [{ name: 'session_id', ok: 'yes' }] },
    ]
    for (const model of ['glm-5.2', 'llama3.1:8b', '(가림)']) expect(OwuiProbeResultSchema.safeParse({ ...ok, model }).success).toBe(true)
    for (const value of bad) expect(OwuiProbeResultSchema.safeParse(value).success).toBe(false)
    // 에이전트 편집의 연결 확인(S13-J)은 같은 허용 목록에서 시험 호출·버전만 뺀다
    const check = { model: 'm', ms: 3, meta, access, account, fetchUrl }
    expect(OwuiAccessCheckSchema.parse({ ...check, attempts: [attempt], session, version: '0.12.0' })).toEqual(check)
    expect(OwuiAccessCheckSchema.safeParse({ ...check, account: { ...account, role: 'svc@corp.example' } }).success).toBe(false)
    expect(OwuiAccessCheckSchema.safeParse({ ...check, access: { ...access, tools: { visible: 1, items: [{ id: 'private-report.pdf', state: 'ok' }] } } }).success).toBe(false)
    // 계정의 이름·이메일·ID 필드는 결과에 남지 않는다
    const parsed = OwuiProbeResultSchema.parse({ ...ok, account: { ...account, name: '실명', email: 'svc@corp.example', id: 'owui-user-7f3a' } })
    expect(JSON.stringify(parsed)).not.toMatch(/실명|corp|owui-user/)
  })
})
