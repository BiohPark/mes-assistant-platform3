import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { AuthGate } from './AuthGate'
import { useMe } from './auth'

function Who() {
  const me = useMe()
  return <div>안녕하세요 {me.name}</div>
}

describe('AuthGate', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('세션이 없으면(401) SSO 로그인으로 보낸다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401)))
    const redirect = vi.fn()
    renderWithProviders(<AuthGate redirectToLogin={redirect}><Who /></AuthGate>)
    await waitFor(() => expect(redirect).toHaveBeenCalledOnce())
    expect(screen.queryByText(/안녕하세요/)).not.toBeInTheDocument()
  })

  it('로그인 사용자를 아래 화면에 넘긴다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { id: 'u1', name: '이담당', role: '', roles: ['member'] })))
    renderWithProviders(<AuthGate redirectToLogin={vi.fn()}><Who /></AuthGate>)
    expect(await screen.findByText('안녕하세요 이담당')).toBeInTheDocument()
  })

  it('서버 오류는 몇 번 다시 시도한 뒤 알리고, 로그인으로 보내지 않는다', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(503))
    vi.stubGlobal('fetch', fetchMock)
    const redirect = vi.fn()
    renderWithProviders(<AuthGate redirectToLogin={redirect}><Who /></AuthGate>)
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent('서버에 연결할 수 없습니다')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('api가 잠깐 내려가 있어도(개발 서버 재시작 등) 다시 시도해서 들어간다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(502))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'u1', name: '이담당', role: '', roles: ['member'] }))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AuthGate redirectToLogin={vi.fn()}><Who /></AuthGate>)
    expect(await screen.findByText('안녕하세요 이담당', {}, { timeout: 5000 })).toBeInTheDocument()
  })
})
