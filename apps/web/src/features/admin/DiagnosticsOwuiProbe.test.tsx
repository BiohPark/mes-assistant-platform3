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
  meta: { found: true, toolIds: ['web_tool', 'docs'], defaultFeatureIds: ['web_search'], capabilities: { vision: true, file_upload: false }, knowledgeCount: 2, functionCalling: 'native' },
  attempts: [
    { mode: 'current', status: 200, firstByteMs: 120, firstContentMs: 900, totalMs: 1100, frames: ['sources', 'choices.delta.reasoning_content ×3', 'choices.delta.content ×2', '[DONE]'] },
    { mode: 'legacy', status: 400, firstByteMs: null, firstContentMs: null, totalMs: 30, frames: [], error: 'HTTP 400 · tool_ids not allowed' },
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
  expect(summary).toHaveTextContent('HTTP 400 · tool_ids not allowed')
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
})

it('호출이 막히면(429) 알림을 띄운다', async () => {
  stubFetch('live', () => jsonResponse(429, { message: '보조 요청이 이미 진행 중입니다' }))
  renderWithProviders(<DiagnosticsPage />)
  const card = await screen.findByRole('region', { name: 'OpenWebUI 진단' })
  fireEvent.click(within(card).getByRole('button', { name: 'OpenWebUI 진단' }))
  expect(await within(card).findByRole('alert')).toHaveTextContent('보조 요청이 이미 진행 중입니다')
})

it('영문 요약도 같은 항목을 담고, 메타가 없으면 확인 불가로 적는다', () => {
  const text = formatOwuiProbe({ ...result, version: null, meta: { ...result.meta, found: false, toolIds: [], defaultFeatureIds: [], capabilities: {}, knowledgeCount: 0, functionCalling: null, error: 'HTTP 401' } } as never, createT('en'))
  expect(text).toContain('OpenWebUI version: Unknown')
  expect(text).toContain('Model meta: Not found (HTTP 401)')
  expect(text).toContain('function_calling: Not set')
  expect(text).toContain('① Current: HTTP 200')
  expect(text).toContain('② Legacy (tool_ids · features · function_calling legacy): HTTP 400')
})
