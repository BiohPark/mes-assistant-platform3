import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { OwuiAccessSummary } from './OwuiAccessSummary'

const check = {
  model: 'agent-a', ms: 120,
  meta: { found: true, toolIds: ['web_tool', 'private_tool'], defaultFeatureIds: ['web_search'], capabilities: { web_search: true }, builtinTools: {}, terminal: true, knowledgeCount: 3, functionCalling: 'native' },
  access: { tools: { visible: 1, items: [{ id: 'web_tool', state: 'ok' }, { id: 'private_tool', state: 'denied' }] }, skills: { visible: 1, items: [{ id: 'skill_off', state: 'inactive' }] } },
  account: { role: 'user', features: { web_search: false, image_generation: null, code_interpreter: null } },
  fetchUrl: [{ name: 'capabilities.web_search', ok: true }, { name: 'features.web_search', ok: true }, { name: 'permission.web_search', ok: false }],
}
const ACCESS = '/api/admin/diagnostics/openwebui/access'
function stub(respond: (body: { model: string }) => Response | Promise<Response> = () => jsonResponse(200, check)) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== ACCESS) throw new Error(`unexpected fetch ${url}`)
    return respond(JSON.parse(String(init?.body)) as { model: string })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
afterEach(() => { vi.unstubAllGlobals() })
/** 시트의 연결 모델 입력처럼 modelId를 바꾼다 */
function Harness({ initial }: { initial: string }) {
  const [model, setModel] = useState(initial)
  return <><input aria-label="model" value={model} onChange={(event) => setModel(event.target.value)} /><OwuiAccessSummary modelId={model} /></>
}
const typeModel = (value: string) => fireEvent.change(screen.getByLabelText('model'), { target: { value } })

it('모델이 있으면 열 때 자동으로 확인하고 도구·스킬 접근·터미널·지식·계정·fetch_url 조건을 이름과 불린만으로 보인다', async () => {
  const fetchMock = stub(() => jsonResponse(200, { ...check, leaked: 'svc@corp.example' }))
  renderWithProviders(<OwuiAccessSummary modelId="agent-a" />)
  const region = screen.getByRole('region', { name: 'OpenWebUI 연결 확인' })
  const summary = await within(region).findByRole('status')
  expect(fetchMock).toHaveBeenCalledWith(ACCESS, expect.objectContaining({ method: 'POST', body: JSON.stringify({ model: 'agent-a' }) }))
  expect(summary).toHaveTextContent('도구 접근 (서비스 계정)web_tool ✅, private_tool ❌ · 보이는 항목 1개')
  expect(summary).toHaveTextContent('스킬 접근 (서비스 계정)skill_off ❌ 비활성 · 보이는 항목 1개')
  expect(summary).toHaveTextContent('기본 터미널설정됨')
  expect(summary).toHaveTextContent('지식3개 (OpenWebUI가 적용)')
  expect(summary).toHaveTextContent('서비스 계정user · web_search ❌')
  expect(summary).toHaveTextContent('fetch_url 조건capabilities.web_search ✅ · features.web_search ✅ · permission.web_search ❌')
  expect(region.textContent).not.toContain('svc@')
  // 시험 호출(①②③)은 없다
  expect(region).not.toHaveTextContent('③')
})

it('새로고침 버튼으로 다시 확인하고, 모델을 바꾸면 잠시 뒤 한 번만 다시 확인한다', async () => {
  const fetchMock = stub(({ model }) => jsonResponse(200, { ...check, model }))
  renderWithProviders(<Harness initial="agent-a" />)
  const region = screen.getByRole('region', { name: 'OpenWebUI 연결 확인' })
  await within(region).findByRole('status')
  fireEvent.click(within(region).getByRole('button', { name: '다시 확인' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  typeModel('agent-b')
  typeModel('agent-c')
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3), { timeout: 2_000 })
  expect(JSON.parse(String(fetchMock.mock.calls[2]![1]!.body))).toEqual({ model: 'agent-c' })
  await new Promise((resolve) => setTimeout(resolve, 700))
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it('모델이 비어 있으면 확인하지 않고, 실패(Mock 모드 400 등)는 경고 없이 조용한 문구로 보인다', async () => {
  const fetchMock = stub(() => jsonResponse(400, { message: 'Live 모드에서만 진단할 수 있습니다' }))
  renderWithProviders(<Harness initial="" />)
  expect(screen.getByRole('region', { name: 'OpenWebUI 연결 확인' })).toHaveTextContent('연결 모델을 정하면 확인합니다')
  await new Promise((resolve) => setTimeout(resolve, 700))
  expect(fetchMock).not.toHaveBeenCalled()
  typeModel('agent-a')
  const region = screen.getByRole('region', { name: 'OpenWebUI 연결 확인' })
  await waitFor(() => expect(region).toHaveTextContent('확인하지 못했습니다: Live 모드에서만 진단할 수 있습니다'), { timeout: 2_000 })
  expect(within(region).queryByRole('alert')).not.toBeInTheDocument()
})

it('허용 목록 밖 값이 섞인 응답은 보여 주지 않는다', async () => {
  stub(() => jsonResponse(200, { ...check, account: { ...check.account, role: 'svc@corp.example' } }))
  renderWithProviders(<OwuiAccessSummary modelId="agent-a" />)
  const region = screen.getByRole('region', { name: 'OpenWebUI 연결 확인' })
  await waitFor(() => expect(region).toHaveTextContent('확인하지 못했습니다: 응답 형식 오류'))
  expect(region.textContent).not.toContain('svc@')
})
