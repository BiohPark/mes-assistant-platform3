import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { UsersPage } from './UsersPage'

vi.mock('@/app/NotificationBell', () => ({ NotificationBell: () => null }))
afterEach(() => vi.unstubAllGlobals())
const me = { id: 'owner', name: '운영자', role: '', roles: ['system_owner'], theme: 'system', locale: 'ko' } as const
function renderPage() { return renderWithProviders(<MeContext value={{ ...me, roles: [...me.roles] }}><TooltipProvider><UsersPage /></TooltipProvider></MeContext>) }

it('사용자 관리 화면은 사용자·역할 목록만 보이고 전역 설정은 조회하지 않는다', async () => {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    return jsonResponse(200, url === '/api/users' ? [{ id: 'other', loginId: 'other', name: '다른 사용자', active: true, isSystemOwner: false, isBusinessOwner: false, mustChangePassword: true }] : [])
  }))
  renderPage()
  expect(await screen.findByRole('heading', { name: '사용자 관리' })).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: '사용자·역할' })).toBeInTheDocument()
  expect(await screen.findByRole('switch', { name: '다른 사용자 SO' })).toBeInTheDocument()
  expect(screen.getByText('변경 대기')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '설정 저장' })).not.toBeInTheDocument()
  expect(urls).not.toContain('/api/settings')
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
    return jsonResponse(200, url === '/api/users' ? [managed] : [])
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
    return jsonResponse(200, [])
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


it('임시 비밀번호는 취소·Escape에는 발급하지 않고 확인 후 결과를 표시한다', async () => {
  const issued: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { issued.push(url); return jsonResponse(200, { temporaryPassword: 'temporary-123' }) }
    return jsonResponse(200, url === '/api/users' ? [{ id: 'other', loginId: 'other', name: '다른 사용자', active: true, isSystemOwner: false, isBusinessOwner: false, mustChangePassword: false }] : [])
  }))
  const user = userEvent.setup()
  renderPage()
  const trigger = await screen.findByRole('button', { name: '임시 비밀번호' })
  await user.click(trigger)
  expect(await screen.findByRole('dialog', { name: '다른 사용자의 임시 비밀번호를 발급할까요?' })).toBeInTheDocument()
  expect(issued).toEqual([])
  await user.click(screen.getByRole('button', { name: '취소' }))
  expect(trigger).toHaveFocus()
  expect(issued).toEqual([])
  await user.click(trigger)
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(issued).toEqual([])
  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: '확인' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('temporary-123'))
  expect(screen.getByRole('alert')).toHaveClass('border-tone-warning-fg/40', 'bg-tone-warning-bg', 'text-tone-warning-fg')
  expect(issued).toEqual(['/api/users/other/temporary-password'])
})

it('임시 비밀번호 확인창은 닫기 애니메이션 동안 발급 제목과 버튼을 유지한다', async () => {
  // jsdom has no CSS animations. Keep Radix Presence mounted until animationend,
  // using the same live animationName change as the browser's computed style.
  const getStyle = window.getComputedStyle.bind(window)
  vi.stubGlobal('getComputedStyle', (element: Element) => {
    const style = getStyle(element)
    if (!element.matches('[data-slot="dialog-content"], [data-slot="dialog-overlay"]')) return style
    Object.defineProperty(style, 'animationName', { get: () => element.getAttribute('data-state') === 'open' ? 'fade-in' : 'fade-out' })
    return style
  })
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/users/other/temporary-password' && init?.method === 'POST') return jsonResponse(200, { temporaryPassword: 'temporary-123' })
    return jsonResponse(200, url === '/api/users' ? [{ id: 'other', loginId: 'other', name: '다른 사용자', active: true, isSystemOwner: false, isBusinessOwner: false, mustChangePassword: false }] : [])
  }))
  const user = userEvent.setup()
  renderPage()
  const trigger = await screen.findByRole('button', { name: '임시 비밀번호' })
  await user.click(trigger)
  const dialog = await screen.findByRole('dialog', { name: '다른 사용자의 임시 비밀번호를 발급할까요?' })
  await user.click(within(dialog).getByRole('button', { name: '확인' }))
  await waitFor(() => expect(dialog).toHaveAttribute('data-state', 'closed'))
  expect(dialog).toBeInTheDocument()
  expect(dialog).toHaveAccessibleName('다른 사용자의 임시 비밀번호를 발급할까요?')
  expect(screen.queryByText('사용자를 비활성화할까요?')).not.toBeInTheDocument()
  expect(dialog.querySelector('[data-slot="dialog-description"]')).toBeNull()
  expect(within(dialog).getByRole('button', { name: '확인' })).toHaveAttribute('data-variant', 'default')
  for (const element of document.querySelectorAll('[data-state="closed"][data-slot^="dialog-"]')) {
    fireEvent(element, Object.assign(new Event('animationend', { bubbles: true }), { animationName: 'fade-out' }))
  }
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
  expect(screen.queryByText('사용자를 비활성화할까요?')).not.toBeInTheDocument()
})
