import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { createT } from '@/i18n'
import { DiagnosticsPage, formatDiagnostics } from './DiagnosticsPage'
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
type Routes = Record<string, () => Response | Promise<Response>>
function stubFetch(routes: Routes) {
  const fetchMock = vi.fn(async (url: string) => {
    const route = routes[url]
    if (!route) throw new Error(`unexpected fetch ${url}`)
    return route()
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
  expect(cell('기본 모델 (.env)')).toHaveTextContent('m')
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
  expect(within(card).getByRole('definition', { name: '기본 모델 (.env)' })).toHaveTextContent('—')
  expect(within(card).getByRole('definition', { name: 'API 키' })).toHaveTextContent('없음')
  const chat = screen.getByRole('region', { name: '시험 대화' })
  expect(within(chat).getByRole('combobox', { name: '모델 선택' })).toBeInTheDocument()
  expect(within(chat).getByRole('textbox', { name: '시험 메시지' })).toBeInTheDocument()
  expect(within(chat).queryByRole('link', { name: '연결 진단 열기' })).not.toBeInTheDocument()
})
