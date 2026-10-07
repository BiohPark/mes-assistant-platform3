import { useQueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthGate } from '@/app/AuthGate'
import type { Me } from '@mes/contracts'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { MyInfoPage } from './MyInfoPage'

vi.mock('@/app/NotificationBell', () => ({ NotificationBell: () => null }))
const me = { id: 'u1', name: '사용자', role: '', roles: ['member'] as const, theme: 'system' as const, locale: 'ko' as const }
function RefreshMe() {
  const client = useQueryClient()
  return <button onClick={() => void client.refetchQueries({ queryKey: ['me'] })}>프로필 새로고침</button>
}

describe('내 정보 프로필 세그먼트', () => {
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })
  it('테마 저장 중 /me의 다른 필드 변경을 유지하고 실패 시 바꾼 필드만 되돌린다', async () => {
    let server: Me = { ...me, roles: [...me.roles] }
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/me' ? Promise.resolve(jsonResponse(200, server)) : new Promise<Response>((resolve) => { finish = resolve })))
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /><RefreshMe /></TooltipProvider></AuthGate>)
    await screen.findByLabelText('이름')
    await userEvent.click(screen.getByRole('radio', { name: '다크' }))
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
    server = { ...server, theme: 'light', locale: 'en' }
    await userEvent.click(screen.getByRole('button', { name: '프로필 새로고침' }))
    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
    expect(document.documentElement).toHaveClass('dark')
    finish(jsonResponse(500, { message: '프로필 저장 실패' }))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'English' })).toBeEnabled())
    expect(document.documentElement).not.toHaveClass('dark')
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('mes-locale')).toBe('en')
    expect(localStorage.getItem('mes-theme')).toBe('light')
    expect(screen.getByRole('radio', { name: '라이트' })).toBeChecked()
  })
  it('늦은 테마 응답이 이미 저장된 새 이름을 덮어쓰지 않는다', async () => {
    let finishName!: (response: Response) => void
    let finishTheme!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/me') return Promise.resolve(jsonResponse(200, { ...me, roles: [...me.roles] }))
      const input = JSON.parse(init!.body as string) as { name?: string }
      return new Promise<Response>((resolve) => { if (input.name) finishName = resolve; else finishTheme = resolve })
    }))
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /></TooltipProvider></AuthGate>)
    await screen.findByLabelText('이름')
    await userEvent.clear(screen.getByLabelText('이름'))
    await userEvent.type(screen.getByLabelText('이름'), '새 이름')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await userEvent.click(screen.getByRole('radio', { name: '다크' }))
    finishName(jsonResponse(200, { name: '새 이름', theme: 'dark', locale: 'ko' }))
    await screen.findByRole('button', { name: /새 이름/ })
    finishTheme(jsonResponse(200, { name: me.name, theme: 'dark', locale: 'ko' }))
    await waitFor(() => expect(screen.getByRole('radio', { name: '다크' })).toBeEnabled())
    expect(screen.getByRole('button', { name: /새 이름/ })).toBeInTheDocument()
    expect(document.documentElement).toHaveClass('dark')
  })
  it('테마와 언어를 선택해 저장하고 이름도 계속 수정할 수 있다', async () => {
    let user: Me = { ...me, roles: [...me.roles] }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/me') return jsonResponse(200, user)
      user = { ...user, ...JSON.parse(init!.body as string) }
      return jsonResponse(200, { name: user.name, theme: user.theme, locale: user.locale })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AuthGate><TooltipProvider><MyInfoPage /></TooltipProvider></AuthGate>)
    await screen.findByLabelText('이름')
    await userEvent.click(screen.getByRole('radio', { name: '다크' }))
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'English' })).toBeEnabled())
    await userEvent.click(screen.getByRole('radio', { name: 'English' }))
    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
    expect(fetchMock).toHaveBeenCalledWith('/api/users/me', expect.objectContaining({ body: JSON.stringify({ locale: 'en' }) }))
    await waitFor(() => expect(screen.getByRole('radio', { name: 'English' })).toBeEnabled())
    await userEvent.clear(screen.getByLabelText('이름'))
    await userEvent.type(screen.getByLabelText('이름'), '새 이름')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /새 이름/ })).toBeInTheDocument())
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.lang).toBe('en')
  })
})
