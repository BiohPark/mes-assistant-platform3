import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { createT } from '@/i18n'
import { DiagnosticsPage } from './DiagnosticsPage'
import { formatOwuiProbe } from './DiagnosticsOwuiProbe'
vi.mock('@/app/TopBar', () => ({ TopBar: ({ title }: { title: string }) => <h1>{title}</h1> }))

const diagnostics = (mode: 'live' | 'mock') => ({
  app: { version: '0.1.0', commit: 'abc', builtAt: '', node: 'v22', os: 'win32' },
  db: { version: '11.8', charset: 'utf8mb4', collation: 'x', migrations: 1 },
  llm: { mode, preset: 'openwebui', baseUrlHost: 'llm.example.com', defaultModel: 'agent-a', ok: true, detail: '', ms: 1 },
  storage: { path: 'D:\\s', writable: true, freeBytes: 1 }, trustProxy: false,
  settings: { authMode: 'local', apiPort: 3000, fileMaxBytes: 1, fileMaxPerRequest: 1, requestMaxActive: 1 },
  secrets: { databasePassword: true, sessionSecret: true, llmApiKey: true, oidcClientSecret: false, devUserPassword: false },
  recentErrors: [],
})
const result = {
  model: 'agent-a', version: '0.12.0', ms: 2400, leaked: 'hidden-answer',
  meta: { found: true, toolIds: ['web_tool', 'docs'], defaultFeatureIds: ['web_search'], capabilities: { vision: true, file_upload: false }, builtinTools: { skills: true, web_search: false }, terminal: true, knowledgeCount: 2, functionCalling: 'native' },
  access: { tools: { visible: 1, items: [{ id: 'web_tool', state: 'ok' }, { id: 'docs', state: 'denied' }] },
    skills: { visible: null, items: [{ id: 'skill_a', state: 'unknown' }], error: 'HTTP 404 · 찾을 수 없음' } },
  account: { role: 'user', features: { web_search: false, image_generation: true, code_interpreter: null } },
  fetchUrl: [{ name: 'session_id', ok: true }, { name: 'web.search.enable', ok: null }, { name: 'permission.web_search', ok: false }],
  session: { status: 200, firstStatusMs: 50, doneMs: 900, totalMs: 1000, statuses: ['web_search ×2', '기타', 'tool_connection!'], cleanup: true },
  attempts: [
    { mode: 'current', status: 200, firstByteMs: 120, firstContentMs: 900, totalMs: 1100, frames: ['sources', 'choices.delta.reasoning_content ×3', 'choices.delta.content ×2', '[DONE]'] },
    { mode: 'legacy', status: 400, firstByteMs: null, firstContentMs: null, totalMs: 30, frames: [], error: 'HTTP 400 · 형식 거부' },
  ],
}
function stubFetch(mode: 'live' | 'mock', probe: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/admin/diagnostics') return jsonResponse(200, diagnostics(mode))
    if (url === '/api/llm/models') return jsonResponse(200, { models: ['agent-a', 'agent-b'] })
    if (url === '/api/admin/diagnostics/openwebui') return probe()
    throw new Error(`unexpected fetch ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
afterEach(() => vi.unstubAllGlobals())

it.each([
  ['model', '모델 기본값 (model)'], ['global', '전역 설정 (global)'],
  ['single', '단일 터미널 자동 선택 (single)'], ['none', '보내지 않음 (none)'],
])('진단은 터미널 출처 %s를 화면과 복사에 표시한다', async (source, label) => {
  stubFetch('live', () => jsonResponse(200, { ...result, meta: { ...result.meta, terminal: source === 'model', terminalSource: source } }))
  const writes: string[] = []
  vi.stubGlobal('navigator', { clipboard: { writeText: async (value: string) => { writes.push(value) } } })
  renderWithProviders(<DiagnosticsPage />)
  const card = await screen.findByRole('region', { name: 'OpenWebUI 진단' })
  fireEvent.click(within(card).getByRole('button', { name: 'OpenWebUI 진단' }))
  expect(await within(card).findByRole('status')).toHaveTextContent(`기본 터미널${label}`)
  fireEvent.click(within(card).getByRole('button', { name: '진단 결과 복사' }))
  await waitFor(() => expect(writes[0]).toContain(`기본 터미널: ${label}`))
})

it('OpenWebUI 진단: 모델 하나로 실행 → 진행 중 → 요약 카드, 복사는 허용된 값만', async () => {
  let resolve: (response: Response) => void = () => undefined
  const fetchMock = stubFetch('live', () => new Promise<Response>((r) => { resolve = r }))
  const writes: string[] = []
  vi.stubGlobal('navigator', { clipboard: { writeText: async (value: string) => { writes.push(value) } } })
  renderWithProviders(<DiagnosticsPage />)
  const card = await screen.findByRole('region', { name: 'OpenWebUI 진단' })
  expect(within(card).getByRole('combobox', { name: '진단 모델' })).toHaveValue('agent-a')
  fireEvent.click(within(card).getByRole('button', { name: 'OpenWebUI 진단' }))
  expect(await within(card).findByRole('button', { name: /진단 중/ })).toBeDisabled()
  expect(fetchMock).toHaveBeenCalledWith('/api/admin/diagnostics/openwebui', expect.objectContaining({ method: 'POST', body: JSON.stringify({ model: 'agent-a' }) }))
  resolve(jsonResponse(200, result))
  const summary = await within(card).findByRole('status')
  expect(summary).toHaveTextContent('OpenWebUI 버전0.12.0')
  expect(summary).toHaveTextContent('web_tool, docs')
  expect(summary).toHaveTextContent('vision 켬 · file_upload 끔')
  expect(summary).toHaveTextContent('지식2개')
  expect(summary).toHaveTextContent('function_callingnative')
  expect(summary).toHaveTextContent('HTTP 200 · 첫 바이트 120 ms · 첫 내용 900 ms · 총 1100 ms')
  expect(summary).toHaveTextContent('sources → choices.delta.reasoning_content ×3 → choices.delta.content ×2 → [DONE]')
  expect(summary).toHaveTextContent('HTTP 400 · 형식 거부')
  // S13-J: 서비스 계정 접근·권한·fetch_url 조건·③ 세션 시험
  expect(summary).toHaveTextContent('도구 접근 (서비스 계정)web_tool ✅, docs ❌ · 보이는 항목 1개')
  expect(summary).toHaveTextContent('스킬 접근 (서비스 계정)skill_a 확인 불가 · 확인 불가 (HTTP 404 · 찾을 수 없음)')
  expect(summary).toHaveTextContent('builtinToolsskills 켬 · web_search 끔')
  expect(summary).toHaveTextContent('기본 터미널설정됨')
  expect(summary).toHaveTextContent('지식2개 (OpenWebUI가 적용)')
  expect(summary).toHaveTextContent('서비스 계정user · web_search ❌ · image_generation ✅ · code_interpreter 확인 불가')
  expect(summary).toHaveTextContent('fetch_url 조건session_id ✅ · web.search.enable 확인 불가 · permission.web_search ❌')
  expect(summary).toHaveTextContent('③ 세션 방식HTTP 200 · 첫 상태 50 ms · 완료 900 ms · 총 1000 ms · 채팅 정리 성공')
  expect(summary).toHaveTextContent('③ 상태 순서web_search ×2 → 기타 → tool_connection!')
  fireEvent.click(within(card).getByRole('button', { name: '진단 결과 복사' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toContain('0.12.0')
  expect(writes[0]).toContain('choices.delta.content ×2')
  expect(writes[0]).not.toContain('hidden-answer')
})

it('Mock 모드는 버튼을 막고 Live 전용임을 안내한다', async () => {
  stubFetch('mock', () => jsonResponse(200, result))
  renderWithProviders(<DiagnosticsPage />)
  const card = await screen.findByRole('region', { name: 'OpenWebUI 진단' })
  expect(within(card).getByRole('button', { name: 'OpenWebUI 진단' })).toBeDisabled()
  expect(card).toHaveTextContent('Live 모드에서만')
  // 남는 위험을 비노출 범위 안내에 적는다 (재리뷰 P2)
  expect(card).toHaveTextContent('모델 목록에 있는 것만')
  expect(card).toHaveTextContent('짧은 식별자처럼 생긴 비밀값은 구분하지 못합니다')
})

it('호출이 막히면(429) 알림을 띄운다', async () => {
  stubFetch('live', () => jsonResponse(429, { message: '보조 요청이 이미 진행 중입니다' }))
  renderWithProviders(<DiagnosticsPage />)
  const card = await screen.findByRole('region', { name: 'OpenWebUI 진단' })
  fireEvent.click(within(card).getByRole('button', { name: 'OpenWebUI 진단' }))
  expect(await within(card).findByRole('alert')).toHaveTextContent('보조 요청이 이미 진행 중입니다')
})

it('영문 요약도 같은 항목을 담고, 메타가 없으면 확인 불가로 적는다', () => {
  const text = formatOwuiProbe({ ...result, version: null, meta: { ...result.meta, found: false, toolIds: [], defaultFeatureIds: [], capabilities: {}, builtinTools: {}, terminal: false, knowledgeCount: 0, functionCalling: null, error: 'HTTP 401 · 인증 거부' },
    account: { role: null, features: { web_search: null, image_generation: null, code_interpreter: null }, error: 'HTTP 403 · 인증 거부' },
    session: { status: 200, firstStatusMs: null, doneMs: null, totalMs: 5, statuses: [], cleanup: null, error: '세션 미지원' } } as never, createT('en'))
  expect(text).toContain('OpenWebUI version: Unknown')
  expect(text).toContain('Model meta: Not found (HTTP 401 · 인증 거부)')
  expect(text).toContain('function_calling: Not set')
  expect(text).toContain('① Current: HTTP 200')
  expect(text).toContain('② Legacy (tool_ids · features · function_calling legacy): HTTP 400')
  expect(text).toContain('builtinTools: Not set (all on by default)')
  expect(text).toContain('Default terminal: None')
  expect(text).toContain('Service account: Unknown · web_search Unknown · image_generation Unknown · code_interpreter Unknown (HTTP 403 · 인증 거부)')
  expect(text).toContain('③ Session: HTTP 200 · total 5 ms · No chat to clean up · 세션 미지원')
  expect(text).toContain('③ Status order: —')
})

it('허용 목록 밖 표기는 화면 언어로 바뀐다 — (가림)·기타', () => {
  const masked = { ...result, meta: { ...result.meta, toolIds: ['web_tool', '(가림)'], functionCalling: '기타' }, attempts: [{ ...result.attempts[0]!, frames: ['기타+sources', 'choices.delta.기타 ×2'] }] }
  const en = formatOwuiProbe(masked as never, createT('en'))
  expect(en).toContain('toolIds: web_tool, (masked)')
  expect(en).toContain('function_calling: other')
  expect(en).toContain('other+sources → choices.delta.other ×2')
  expect(formatOwuiProbe(masked as never, createT('ko'))).toContain('toolIds: web_tool, (가림)')
})

it('서버 응답에 허용 목록 밖 값이 섞이면 보여 주지도 복사하지도 않는다 (리뷰 P1 ×4)', async () => {
  const SECRET = 'sk-live-9f8e7d6c5b4a'
  const leaks = [
    { ...result, meta: { ...result.meta, capabilities: { [SECRET]: true } } },
    { ...result, attempts: [{ ...result.attempts[0]!, frames: ['confidential_answer'] }] },
    { ...result, meta: { ...result.meta, toolIds: ['10.20.30.40', 'private-report.pdf'] } },
    { ...result, attempts: [{ ...result.attempts[1]!, error: `HTTP 400 · Cookie: sid=${SECRET}` }] },
  ]
  for (const leak of leaks) {
    stubFetch('live', () => jsonResponse(200, leak))
    const writes: string[] = []
    vi.stubGlobal('navigator', { clipboard: { writeText: async (value: string) => { writes.push(value) } } })
    const { unmount } = renderWithProviders(<DiagnosticsPage />)
    const card = await screen.findByRole('region', { name: 'OpenWebUI 진단' })
    fireEvent.click(within(card).getByRole('button', { name: 'OpenWebUI 진단' }))
    expect(await within(card).findByRole('alert')).toBeInTheDocument()
    expect(within(card).queryByRole('status')).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: '진단 결과 복사' })).not.toBeInTheDocument()
    expect(card.textContent).not.toMatch(/sk-live|confidential|10\.20\.30\.40|private-report|Cookie/)
    expect(writes).toEqual([])
    unmount()
    vi.unstubAllGlobals()
  }
})
