import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { createT } from '@/i18n'
import { checkSse, DiagnosticsPage, formatDiagnostics } from './DiagnosticsPage'
vi.mock('@/app/hooks', () => ({ useAssistants: () => [{ id: 'a', name: '에이전트 A', modelId: 'agent-a' }, { id: 'b', name: '에이전트 B', modelId: 'agent-b' }, { id: 'c', name: '기본 모델 에이전트', modelId: '' }] }))
vi.mock('@/app/TopBar', () => ({ TopBar: ({ title }: { title: string }) => <h1>{title}</h1> }))

const data = {
  app: { version: '0.1.0', commit: 'abc123', builtAt: '2026-10-08T00:00:00Z', node: 'v22', os: 'win32' },
  db: { version: '11.8', charset: 'utf8mb4', collation: 'utf8mb4_nopad_bin', migrations: 4 },
  llm: { mode: 'live', preset: 'openwebui', baseUrlHost: 'llm.example.com', defaultModel: 'm', ok: true, detail: '연결 성공', ms: 42 },
  storage: { path: 'D:\\mes-hub\\storage', writable: true, freeBytes: 1024 }, trustProxy: false,
  settings: { authMode: 'local', apiPort: 3000, fileMaxBytes: 100, fileMaxPerRequest: 2, requestMaxActive: 20 },
  secrets: { databasePassword: true, sessionSecret: true, llmApiKey: true, oidcClientSecret: false, devUserPassword: false },
  recentErrors: [{ at: '2026-10-08', path: '/api/test', status: 500, message: 'HTTP 500' }],
}
type Routes = Record<string, (init?: RequestInit) => Response | Promise<Response>>
function stubFetch(routes: Routes) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const route = routes[url]
    if (!route) throw new Error(`unexpected fetch ${url}`)
    return route(init)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const base: Routes = {
  '/api/admin/diagnostics': () => jsonResponse(200, { ...data, leakedSecret: 'hidden-key' }),
  '/api/llm/models': () => jsonResponse(200, { models: ['m', 'fake-writer'] }),
}
afterEach(() => vi.unstubAllGlobals())

it('진단을 다시 조회하고 허용된 값만 평문 복사한다', async () => {
  const writes: string[] = []
  const fetchMock = stubFetch(base)
  vi.stubGlobal('navigator', { clipboard: { writeText: async (value: string) => { writes.push(value) } } })
  renderWithProviders(<DiagnosticsPage />)
  expect(await screen.findByText('llm.example.com')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '텍스트로 복사' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toContain('abc123')
  expect(writes[0]).not.toContain('hidden-key')
  fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/admin/diagnostics')).toHaveLength(2))
})

it('진단 평문은 비밀 설정의 존재 여부만 담는다', () => {
  const response = { ...data, trustProxy: false as const, leakedSecret: 'hidden-key' }
  const text = formatDiagnostics(response, createT('ko'))
  expect(text).toContain('SESSION_SECRET: 설정됨')
  expect(text).not.toContain('hidden-key')
})

it('AI 연결 카드는 모드·프리셋+호스트·기본 모델(.env)·키 여부 4칸과 .env 안내를 보여주고, 연결 시험 결과를 2줄로 적는다', async () => {
  const fetchMock = stubFetch({ ...base, '/api/admin/llm/test-connection': () => jsonResponse(200, { models: { ok: true, count: 2, ms: 12 }, completion: { ok: true, ms: 300, model: 'm' } }) })
  renderWithProviders(<DiagnosticsPage />)
  const card = await screen.findByRole('region', { name: 'AI 연결' })
  const cell = (name: string) => within(card).getByRole('definition', { name })
  expect(cell('모드')).toHaveTextContent('Live')
  expect(cell('프리셋 · 호스트')).toHaveTextContent('openwebui · llm.example.com')
  expect(cell('현재 적용 모델')).toHaveTextContent('m')
  expect(cell('API 키')).toHaveTextContent('설정됨')
  const guide = within(card).getByText(/LLM_BASE_URL/)
  expect(guide).toHaveTextContent('.env')
  expect(guide.textContent).not.toMatch(/https?:\/\//)
  fireEvent.click(within(card).getByRole('button', { name: '연결 시험' }))
  const result = await within(card).findByRole('status')
  await waitFor(() => expect(result).toHaveTextContent('모델 목록: 성공 · 2개 · 12 ms'))
  expect(result).toHaveTextContent('응답: 성공 · m · 300 ms')
  expect(fetchMock).toHaveBeenCalledWith('/api/admin/llm/test-connection', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }))
})

it('연결 시험 실패는 각 줄에 실패와 이유를 적고, 호출 자체가 막히면 알림을 띄운다', async () => {
  stubFetch({ ...base, '/api/admin/llm/test-connection': () => jsonResponse(200, { models: { ok: false, count: 0, ms: 5, error: 'HTTP 401' }, completion: { ok: false, ms: 60000, model: 'm', error: '응답 시간 초과' } }) })
  renderWithProviders(<DiagnosticsPage />)
  const card = await screen.findByRole('region', { name: 'AI 연결' })
  fireEvent.click(within(card).getByRole('button', { name: '연결 시험' }))
  const result = await within(card).findByRole('status')
  await waitFor(() => expect(result).toHaveTextContent('모델 목록: 실패 · HTTP 401'))
  expect(result).toHaveTextContent('응답: 실패 · 응답 시간 초과')
  vi.unstubAllGlobals()
  stubFetch({ ...base, '/api/admin/llm/test-connection': () => jsonResponse(429, { message: '동시 응답이 많아 잠시 후 다시 시도해 주세요.' }) })
  fireEvent.click(within(card).getByRole('button', { name: '연결 시험' }))
  expect(await within(card).findByRole('alert')).toHaveTextContent('연결 시험을 실행하지 못했습니다 (429)')
})

it('Mock 모드는 호스트 없이 Mock으로, 키가 없으면 없음으로 보인다 — 시험 대화 구획에 모델 선택과 대화가 있다', async () => {
  stubFetch({ ...base, '/api/admin/diagnostics': () => jsonResponse(200, { ...data, llm: { ...data.llm, mode: 'mock', baseUrlHost: '', defaultModel: '' }, secrets: { ...data.secrets, llmApiKey: false } }) })
  renderWithProviders(<DiagnosticsPage />)
  const card = await screen.findByRole('region', { name: 'AI 연결' })
  expect(within(card).getByRole('definition', { name: '모드' })).toHaveTextContent('Mock')
  expect(within(card).getByRole('definition', { name: '프리셋 · 호스트' })).toHaveTextContent('openwebui · —')
  expect(within(card).getByRole('definition', { name: '현재 적용 모델' })).toHaveTextContent('—')
  expect(within(card).getByRole('definition', { name: 'API 키' })).toHaveTextContent('없음')
  const chat = screen.getByRole('region', { name: '시험 대화' })
  expect(within(chat).getByRole('combobox', { name: '모델 선택' })).toBeInTheDocument()
  expect(within(chat).getByRole('textbox', { name: '시험 메시지' })).toBeInTheDocument()
  expect(within(chat).queryByRole('link', { name: '연결 진단 열기' })).not.toBeInTheDocument()
})

it('저장소 경로 옆에 상대 경로의 env 기준과 이미지 누락 경고를 보여주고 복사한다', async () => {
  const storage = { ...data.storage, resolution: { configuredPath: './storage', baseDir: 'D:/config', envFile: 'D:/config/.env' }, assistantImages: { configured: 3, missing: 2, unreadable: 0 } }
  stubFetch({ ...base, '/api/admin/diagnostics': () => jsonResponse(200, { ...data, storage }) })
  renderWithProviders(<DiagnosticsPage />)
  expect(await screen.findByText(/상대 경로 기준.*D:\/config/)).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('도우미 이미지 2개의 파일이 없습니다')
  const text = formatDiagnostics({ ...data, trustProxy: false as const, storage }, createT('ko'))
  expect(text).toContain('D:/config/.env')
  expect(text).toContain('도우미 이미지 2개의 파일이 없습니다')
})

it('env 없이 상대 경로를 쓰면 저장소 루트 기준임을 보여 준다', async () => {
  const storage = { ...data.storage, resolution: { configuredPath: 'storage', baseDir: '/repo', envFile: null }, assistantImages: { configured: 0, missing: 0, unreadable: 0 } }
  stubFetch({ ...base, '/api/admin/diagnostics': () => jsonResponse(200, { ...data, storage }) })
  renderWithProviders(<DiagnosticsPage />)
  expect(await screen.findByText(/저장소 루트.*\/repo/)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('진단에서 에이전트를 고르면 연결 모델의 접근·권한을 확인하고 바꾼 에이전트로 다시 점검한다', async () => {
  const checks: string[] = []
  stubFetch({ ...base, '/api/admin/diagnostics/openwebui/access': (init) => {
    const { model } = JSON.parse(String(init?.body)) as { model: string }
    checks.push(model)
    return jsonResponse(200, { model, ms: 1,
      meta: { found: true, toolIds: [], defaultFeatureIds: [], capabilities: { web_search: true }, builtinTools: {}, terminal: false, knowledgeCount: 0, functionCalling: 'native' },
      access: { tools: { visible: 0, items: [] }, skills: { visible: 0, items: [] } },
      account: { role: 'user', features: { web_search: true, image_generation: null, code_interpreter: null } }, fetchUrl: [{ name: 'features.web_search', ok: true }] })
  } })
  const originalScroll = HTMLElement.prototype.scrollIntoView
  HTMLElement.prototype.scrollIntoView = vi.fn()
  try {
    renderWithProviders(<DiagnosticsPage />)
    const select = await screen.findByRole('combobox', { name: '연결 확인 에이전트' })
    expect(checks).toEqual([])
    fireEvent.keyDown(select, { key: 'ArrowDown' })
    fireEvent.keyDown(await screen.findByRole('option', { name: '에이전트 A' }), { key: 'Enter' })
    const region = await screen.findByRole('region', { name: 'OpenWebUI 연결 확인' })
    expect(await within(region).findByRole('status')).toHaveTextContent('features.web_search URL 포함 시 자동')
    expect(checks).toEqual(['agent-a'])
    fireEvent.keyDown(select, { key: 'ArrowDown' })
    fireEvent.keyDown(await screen.findByRole('option', { name: '에이전트 B' }), { key: 'Enter' })
    await waitFor(() => expect(checks).toEqual(['agent-a', 'agent-b']))
    fireEvent.keyDown(select, { key: 'ArrowDown' })
    fireEvent.keyDown(await screen.findByRole('option', { name: '기본 모델 에이전트' }), { key: 'Enter' })
    await waitFor(() => expect(checks).toEqual(['agent-a', 'agent-b', 'm']))
  } finally { HTMLElement.prototype.scrollIntoView = originalScroll }
})

const sse = (offsets: number[]) => () => new Response(offsets.map((sentAt, seq) => `event: ping\ndata: ${JSON.stringify({ seq, sentAt })}\n\n`).join(''), { status: 200 })

it('SSE check measures the round trip and the first signal, and calls paced signals unbuffered', async () => {
  stubFetch({ '/api/health': () => jsonResponse(200, { ok: true }), '/api/admin/diagnostics/sse': sse([0, 500, 1000]) })
  // 시계: 왕복 시작 0 → 끝 40, 스트림 시작 100 → 신호 도착 160·660·1160(간격 유지)
  const times = [0, 40, 100, 160, 660, 1160]
  expect(await checkSse(() => times.shift()!)).toEqual({ rttMs: 40, firstMs: 60, count: 3, sentSpreadMs: 1000, receivedSpreadMs: 1000, buffered: false })
})

it('SSE check flags buffering when the signals arrive bunched together and shows it on the page', async () => {
  stubFetch({ ...base, '/api/health': () => jsonResponse(200, { ok: true }), '/api/admin/diagnostics/sse': sse([0, 500, 1000]) })
  const times = [0, 30, 100, 1210, 1211, 1212]
  expect(await checkSse(() => times.shift()!)).toMatchObject({ firstMs: 1110, receivedSpreadMs: 2, buffered: true })
  renderWithProviders(<DiagnosticsPage />)
  fireEvent.click(await screen.findByRole('button', { name: '점검' }))
  const region = screen.getByRole('region', { name: '실시간 연결(SSE) 점검' })
  await waitFor(() => expect(within(region).getByRole('status')).toHaveTextContent(/서버 왕복 \d+ ms · 첫 신호 \d+ ms · 신호 3개/))
})
