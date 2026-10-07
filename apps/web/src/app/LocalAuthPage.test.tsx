import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { LocalAuthPage } from './LocalAuthPage'

describe('local 인증 화면', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('로그인 폼은 API에 제출하고 성공하면 홈으로 간다', async () => {
    const fetchMock = vi.fn(async (url: string) => url === '/api/auth/mode' ? jsonResponse(200, { mode: 'local' }) : jsonResponse(200, { id: 'u1', name: 'member', role: '', roles: ['member'] }))
    vi.stubGlobal('fetch', fetchMock)
    const navigate = vi.fn()
    renderWithProviders(<LocalAuthPage kind="login" onSuccess={navigate} />)
    await userEvent.type(screen.getByLabelText('ID'), 'member')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password-1234')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }))
  })

  it('401 오류 메시지를 폼 아래에 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/mode' ? jsonResponse(200, { mode: 'local' }) : jsonResponse(401, { message: 'ID 또는 비밀번호가 올바르지 않습니다' })))
    renderWithProviders(<LocalAuthPage kind="login" />)
    await userEvent.type(screen.getByLabelText('ID'), 'member')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ID 또는 비밀번호가 올바르지 않습니다')
  })

  it('회원가입 폼의 비밀번호 확인이 다르면 전송하지 않는다', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { mode: 'local' }))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<LocalAuthPage kind="signup" />)
    await userEvent.type(screen.getByLabelText('ID'), 'member')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password-1234')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'different-password')
    await userEvent.click(screen.getByRole('button', { name: '회원가입' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('비밀번호가 일치하지 않습니다')
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/signup', expect.anything())
  })

  it('회원가입 이름을 필수로 받고 API에 전송한다', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url === '/api/auth/mode' ? jsonResponse(200, { mode: 'local' }) : jsonResponse(201, { id: 'u', name: '홍길동', role: '', roles: ['member'] }))
    vi.stubGlobal('fetch', fetchMock)
    const navigate = vi.fn()
    renderWithProviders(<LocalAuthPage kind="signup" onSuccess={navigate} />)
    await userEvent.type(screen.getByLabelText('ID'), 'member')
    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password-1234')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'password-1234')
    await userEvent.click(screen.getByRole('button', { name: '회원가입' }))
    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => url === '/api/auth/signup')?.[1]?.body))).toMatchObject({ name: '홍길동' })
  })
})
