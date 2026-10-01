import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse } from '@/test/render'
import { applyProposal, toProposal } from './actions'

const assistant = { id: 'fds', name: 'FDS 작성 도우미', level1: 'SDLC', level2: 'FDS', level1CodeId: 'l1', level2CodeId: 'l2', summary: '', order: 1, ownerId: 'u', status: 'open', usageExample: '', expectedInputs: [], expectedOutputs: [], color: '#123456', checklistTemplate: [], createdBy: 'u', createdAt: '2026-01-01', updatedAt: '2026-01-01', revision: 0 }
const codes = [
  { id: 'l1', groupKey: 'assistant_level1', code: 'Record', name: 'Record', sortOrder: 1, active: true },
  { id: 'l2', groupKey: 'assistant_level2', code: '라벨', name: '라벨', sortOrder: 1, active: true },
]

afterEach(() => vi.unstubAllGlobals())

describe('system assistant proposals', () => {
  it('도구별 요약을 만들고 잘못된 JSON도 안전하게 표시한다', () => {
    expect(toProposal({ id: '1', name: 'start_conversation', arguments: '{"assistantName":"FDS 작성 도우미","title":"테스트","tags":["SR-2026-0001"]}' }).summary).toContain('FDS 작성 도우미 — "테스트" · 태그 SR-2026-0001')
    expect(toProposal({ id: '2', name: 'create_assistant', arguments: '{"id":"label-check","name":"라벨 검증","level1":"Record","level2":"라벨"}' }).summary).toContain('라벨 검증 (label-check) — Record › 라벨')
    expect(toProposal({ id: '3', name: 'add_tag', arguments: '{"taskCode":"WK-2026-0006","tag":"#release"}' }).summary).toContain('WK-2026-0006 ← release')
    expect(toProposal({ id: '4', name: 'add_tag', arguments: '{bad' }).args).toEqual({})
  })

  it('적용할 선택 인자를 모두 요약하고 잘못된 인자는 제안에서 제외한다', () => {
    expect(toProposal({ id: 'p', name: 'start_conversation', arguments: '{"assistantName":"FDS","priority":"urgent"}' }).summary).toContain('우선순위 urgent')
    const assistantProposal = toProposal({ id: 'a', name: 'create_assistant', arguments: '{"id":"label","name":"라벨","level1":"Record","level2":"라벨","summary":"설명","ownerName":"담당자","modelId":"model-x"}' })
    expect(assistantProposal.summary).toContain('설명')
    expect(assistantProposal.summary).toContain('담당자')
    expect(assistantProposal.summary).toContain('model-x')
    const invalid = toProposal({ id: 'bad', name: 'start_conversation', arguments: '{"assistantName":"FDS","priority":"critical"}' })
    expect(invalid.invalidReason).toBeTruthy()
    expect(invalid.summary).toContain('유효하지')
    expect(toProposal({ id: 'missing', name: 'add_tag', arguments: '{"taskCode":"WK-2026-0006"}' }).invalidReason).toBeTruthy()
    expect(toProposal({ id: 'unknown', name: 'other', arguments: '{}' }).invalidReason).toBeTruthy()
  })

  it('검증 실패한 제안은 API를 호출하지 않고 사유를 반환한다', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const proposal = toProposal({ id: 'bad', name: 'create_assistant', arguments: '{"id":"x","name":"X","level1":"Record","level2":"라벨","modelId":42}' })
    const result = await applyProposal({ userId: 'u' }, proposal)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('modelId')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('응답 유실 후 같은 제안을 재시도할 때 동일한 멱등 키를 보낸다', async () => {
    const keys: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/assistants') return jsonResponse(200, [assistant])
      if (url === '/api/tasks') {
        keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '')
        return keys.length === 1 ? jsonResponse(503, { message: '응답 유실' }) : jsonResponse(201, { id: 'task-1', code: 'WK-2026-0001', threadId: 'thread-1' })
      }
      return jsonResponse(404)
    }))
    const proposal = toProposal({ id: 'call_1', name: 'start_conversation', arguments: '{"assistantName":"FDS"}' })
    expect((await applyProposal({ userId: 'u' }, proposal)).ok).toBe(false)
    expect((await applyProposal({ userId: 'u' }, proposal)).ok).toBe(true)
    expect(keys).toEqual(['system-assistant:call_1', 'system-assistant:call_1'])
  })

  it('이름 부분 일치 에이전트로 기존 대화 API를 호출한다', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      if (url === '/api/assistants') return jsonResponse(200, [assistant])
      if (url === '/api/tasks') return jsonResponse(201, { id: 'task-1', code: 'WK-2026-0001', threadId: 'thread-1' })
      return jsonResponse(404)
    }))
    const result = await applyProposal({ userId: 'u' }, toProposal({ id: '1', name: 'start_conversation', arguments: '{"assistantName":"fds 작성","title":"테스트","tags":["SR-2026-0001"]}' }))
    expect(result).toEqual({ ok: true, message: expect.stringContaining('WK-2026-0001'), link: '/c/task-1' })
    expect(JSON.parse(String(calls.find(([url]) => url === '/api/tasks')?.[1]?.body))).toMatchObject({ assistantId: 'fds', title: '테스트', tags: ['SR-2026-0001'] })
  })

  it('없는 에이전트와 API 403을 실패로 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
    expect(await applyProposal({ userId: 'u' }, toProposal({ id: '1', name: 'start_conversation', arguments: '{"assistantName":"없음"}' }))).toMatchObject({ ok: false, message: expect.stringContaining('찾을 수 없습니다') })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/codes' ? jsonResponse(200, codes) : url === '/api/catalog/users' ? jsonResponse(200, []) : jsonResponse(403, { message: '권한이 없습니다' })))
    const result = await applyProposal({ userId: 'u' }, toProposal({ id: '2', name: 'create_assistant', arguments: '{"id":"label","name":"라벨","level1":"Record","level2":"라벨"}' }))
    expect(result).toEqual({ ok: false, message: '권한이 없습니다' })
  })
})
