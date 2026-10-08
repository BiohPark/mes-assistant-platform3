import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { SettingsPage } from './SettingsPage'

vi.mock('@/app/NotificationBell', () => ({ NotificationBell: () => null }))
const assistants = [
  { id: 'a', name: '접수 도우미', status: 'open' }, { id: 'old', name: '폐기 도우미', status: 'retired' },
]
vi.mock('@/app/hooks', () => ({ useAssistants: () => assistants }))
afterEach(() => vi.unstubAllGlobals())
const me = { id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system', locale: 'ko' } as const
function renderPage() { return renderWithProviders(<MeContext value={{ ...me, roles: [...me.roles] }}><TooltipProvider><SettingsPage /></TooltipProvider></MeContext>) }

it('라디오 카드·접수 에이전트 키보드 선택과 지정 해제를 설정에 저장한다', async () => {
  const saved: unknown[] = []
  const initial = { defaultModel: 'model', fileDelivery: 'inline', srIntakeAssistantId: null }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/settings') {
      if (init?.method === 'PATCH') { const body = JSON.parse(String(init.body)); saved.push(body); Object.assign(initial, body) }
      return jsonResponse(200, initial)
    }
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup()
  renderPage()
  const inline = await screen.findByRole('radio', { name: '텍스트로 붙이기' })
  inline.focus()
  await user.keyboard('{ArrowRight>}')
  await waitFor(() => expect(screen.getByRole('radio', { name: 'OpenWebUI 파일 첨부' })).toBeChecked())
  await user.keyboard('{/ArrowRight}')
  const picker = screen.getByRole('combobox', { name: 'SR 접수 에이전트' })
  await user.click(picker)
  expect(screen.queryByRole('option', { name: '폐기 도우미' })).not.toBeInTheDocument()
  await screen.findByRole('option', { name: '접수 도우미' })
  await user.keyboard('{ArrowDown}{Enter}')
  await user.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(saved).toHaveLength(1))
  expect(saved[0]).toMatchObject({ fileDelivery: 'openwebui', srIntakeAssistantId: 'a' })
  await screen.findByRole('button', { name: '접수 도우미 제거' })
  await user.click(screen.getByRole('button', { name: '지정 안 함' }))
  await user.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(saved).toHaveLength(2))
  expect(saved[1]).toMatchObject({ srIntakeAssistantId: null })
})

it('AI 연결 요약 카드는 /api/llm/status를 보여 주고 연결 진단으로 이어진다 — 사용자 목록은 여기서 조회하지 않는다', async () => {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    if (url === '/api/llm/status') return jsonResponse(200, { mode: 'live', preset: 'openwebui', baseUrlHost: 'llm.example.com', ok: false, detail: 'HTTP 503' })
    return jsonResponse(200, url === '/api/settings' ? { defaultModel: 'model' } : [])
  }))
  renderPage()
  const summary = await screen.findByRole('region', { name: 'AI 연결 요약' })
  expect(await within(summary).findByText('Live')).toBeInTheDocument()
  expect(within(summary).getByText('openwebui')).toBeInTheDocument()
  expect(within(summary).getByText('llm.example.com')).toBeInTheDocument()
  expect(within(summary).getByText('실패 (HTTP 503)')).toBeInTheDocument()
  expect(within(summary).getByRole('link', { name: '연결 진단 열기' })).toHaveAttribute('href', '/admin/diagnostics')
  await screen.findByRole('button', { name: '설정 저장' })
  expect(screen.queryByRole('heading', { name: '사용자·역할' })).not.toBeInTheDocument()
  expect(urls).not.toContain('/api/users')
})
