import { screen, waitFor } from '@testing-library/react'
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

it.each(['SO', '활성'])('%s 해제 확인 취소·Escape는 미변경, 승인만 서버에 반영한다', async label => {
  const managed = { id: 'other', loginId: 'other', name: '다른 사용자', active: true, isSystemOwner: true, isBusinessOwner: false, mustChangePassword: false }
  const writes: Array<[string, unknown]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { enabled: boolean }; writes.push([url, body])
      if (url.endsWith('/system-owner')) managed.isSystemOwner = body.enabled
      if (url.endsWith('/active')) managed.active = body.enabled
      return jsonResponse(200, managed)
    }
    return jsonResponse(200, url === '/api/users' ? [managed] : url === '/api/settings' ? { defaultModel: 'model' } : [])
  }))
  const user = userEvent.setup()
  renderPage()
  const toggle = await screen.findByRole('switch', { name: `다른 사용자 ${label}` })
  toggle.focus()
  await user.keyboard(' ')
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(toggle).toBeChecked()
  expect(writes).toEqual([])
  await user.click(screen.getByRole('button', { name: '취소' }))
  expect(toggle).toBeChecked()
  expect(toggle).toHaveFocus()
  expect(writes).toEqual([])
  await user.click(toggle)
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(toggle).toBeChecked()
  expect(toggle).toHaveFocus()
  expect(writes).toEqual([])
  await user.click(toggle)
  await user.click(screen.getByRole('button', { name: '확인' }))
  await waitFor(() => expect(toggle).not.toBeChecked())
  expect(writes).toEqual([[`/api/users/other/${label === 'SO' ? 'system-owner' : 'active'}`, { enabled: false }]])
  await user.click(toggle)
  await waitFor(() => expect(toggle).toBeChecked())
  expect(writes[1]).toEqual([`/api/users/other/${label === 'SO' ? 'system-owner' : 'active'}`, { enabled: true }])
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('BO Switch는 키보드로 바로 변경한다', async () => {
  let enabled = false
  const writes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/business-owner') && init?.method === 'PUT') { const body = JSON.parse(String(init.body)); writes.push(body); enabled = body.enabled; return jsonResponse(200, {}) }
    if (url === '/api/users') return jsonResponse(200, [{ id: 'other', loginId: null, name: '다른 사용자', active: true, isSystemOwner: false, isBusinessOwner: enabled, mustChangePassword: false }])
    return jsonResponse(200, url === '/api/settings' ? { defaultModel: 'model' } : [])
  }))
  const user = userEvent.setup()
  renderPage()
  const toggle = await screen.findByRole('switch', { name: '다른 사용자 BO' })
  toggle.focus()
  await user.keyboard(' ')
  await waitFor(() => expect(toggle).toBeChecked())
  expect(writes).toEqual([{ enabled: true }])
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
