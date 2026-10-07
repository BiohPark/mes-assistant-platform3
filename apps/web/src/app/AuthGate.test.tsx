import { useQueryClient } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { AuthGate } from './AuthGate'
import { useMe } from './auth'

function Who() {
  const me = useMe()
  const client = useQueryClient()
  return <><div>안녕하세요 {me.name}</div><button onClick={() => client.setQueryData(['me'], { ...me, id: 'u2', name: '다른 사용자', theme: 'light', locale: 'ko' })}>사용자 전환</button></>
}

describe('AuthGate', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('/me 프로필이 로그인 전 캐시를 덮어쓰고 사용자 변경도 반영한다', async () => {
    localStorage.setItem('mes-theme', 'light')
    localStorage.setItem('mes-locale', 'ko')
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { id: 'u1', name: '이담당', role: '', roles: ['member'], theme: 'dark', locale: 'en' })))
    renderWithProviders(<AuthGate redirectToLogin={vi.fn()}><Who /></AuthGate>)
    expect(await screen.findByText('안녕하세요 이담당')).toBeInTheDocument()
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('mes-theme')).toBe('dark')
    expect(localStorage.getItem('mes-locale')).toBe('en')
    await userEvent.click(screen.getByRole('button', { name: '사용자 전환' }))
    expect(await screen.findByText('안녕하세요 다른 사용자')).toBeInTheDocument()
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'))
    expect(document.documentElement.lang).toBe('ko')
    expect(localStorage.getItem('mes-theme')).toBe('light')
    expect(localStorage.getItem('mes-locale')).toBe('ko')
    localStorage.clear()
  })

  it('세션이 없으면(401) SSO 로그인으로 보낸다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/mode' ? jsonResponse(200, { mode: 'oidc' }) : jsonResponse(401)))
    const redirect = vi.fn()
    renderWithProviders(<AuthGate redirectToLogin={redirect}><Who /></AuthGate>)
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('/api/auth/login'))
    expect(screen.queryByText(/안녕하세요/)).not.toBeInTheDocument()
  })

  it('local 모드에서 401이면 /login으로 보낸다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/mode' ? jsonResponse(200, { mode: 'local' }) : jsonResponse(401)))
    const redirect = vi.fn()
    renderWithProviders(<AuthGate redirectToLogin={redirect}><Who /></AuthGate>)
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('/login'))
  })

  it('로그인 사용자를 아래 화면에 넘긴다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { id: 'u1', name: '이담당', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const })))
    renderWithProviders(<AuthGate redirectToLogin={vi.fn()}><Who /></AuthGate>)
    expect(await screen.findByText('안녕하세요 이담당')).toBeInTheDocument()
  })

  it('서버 오류는 몇 번(약 5초) 다시 시도한 뒤 알리고, 로그인으로 보내지 않는다', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(503))
    vi.stubGlobal('fetch', fetchMock)
    const redirect = vi.fn()
    renderWithProviders(<AuthGate redirectToLogin={redirect} retryDelayMs={1}><Who /></AuthGate>)
    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다')
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(redirect).not.toHaveBeenCalled()

    // 서버가 돌아오면 "다시 시도"로 새로고침 없이 들어간다
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'u1', name: '이담당', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const }))
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('안녕하세요 이담당')).toBeInTheDocument()
  })

  it('모드 조회가 계속 실패하면 오류와 다시 시도 버튼을 보여준다', async () => {
    const fetchMock = vi.fn(async (url: string) => url === '/api/me' ? jsonResponse(401) : jsonResponse(503))
    vi.stubGlobal('fetch', fetchMock)
    const redirect = vi.fn()
    renderWithProviders(<AuthGate redirectToLogin={redirect} retryDelayMs={1}><Who /></AuthGate>)
    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다')
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(7)
    expect(redirect).not.toHaveBeenCalled()
    fetchMock.mockImplementation(async (url: string) => url === '/api/me' ? jsonResponse(401) : jsonResponse(200, { mode: 'local' }))
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('/login'))
  })

  it('api가 잠깐 내려가 있어도(개발 서버 재시작 등) 다시 시도해서 들어간다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(502))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'u1', name: '이담당', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const }))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AuthGate redirectToLogin={vi.fn()} retryDelayMs={1}><Who /></AuthGate>)
    expect(await screen.findByText('안녕하세요 이담당')).toBeInTheDocument()
  })
})
