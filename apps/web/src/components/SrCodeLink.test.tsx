import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import type { Me } from '@mes/contracts'
import { MeContext } from '@/app/auth'
import { Markdown } from './Markdown'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))
afterEach(() => { vi.unstubAllGlobals(); toastError.mockReset() })

const me = (roles: Me['roles']): Me => ({ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles, theme: 'system', locale: 'ko' })
function Probe() { const location = useLocation(); return <output aria-label="경로">{location.pathname + location.search}</output> }
function stubLookup() {
  const fetch = vi.fn(async (url: string) => Response.json(url === '/api/service-requests?code=SR-2026-0001' ? [{ id: 'sr-1', code: 'SR-2026-0001' }] : []))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const content = '처리: SR-2026-0001, sr-2026-0002 확인\n\n`SR-2026-0003` [링크 SR-2026-0004](https://example.com/a) SR-2026-00012'

it('S14: 본문 텍스트의 SR 번호만 링크로 바꾸고(코드·기존 링크·긴 번호 제외) 처리 담당자는 처리 상세로 간다', async () => {
  const fetch = stubLookup()
  render(<MeContext value={me(['member'])}><MemoryRouter initialEntries={['/c/t']}><Markdown content={content} /><Probe /></MemoryRouter></MeContext>)
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['SR-2026-0001', 'sr-2026-0002'])
  expect(screen.getByRole('button', { name: 'SR-2026-0001' })).toHaveAttribute('title', 'SR-2026-0001 상세 열기')
  expect(screen.getByText('SR-2026-0003').tagName).toBe('CODE')
  expect(screen.getByRole('link', { name: '링크 SR-2026-0004' })).toHaveAttribute('href', 'https://example.com/a')
  await userEvent.click(screen.getByRole('button', { name: 'SR-2026-0001' }))
  await waitFor(() => expect(screen.getByLabelText('경로')).toHaveTextContent('/sr/manage?id=sr-1'))
  expect(fetch).toHaveBeenCalledWith('/api/service-requests?code=SR-2026-0001', expect.anything())
})

it('S14: 요청자(BO)는 요청 화면으로 가고, 없거나 볼 수 없는 SR은 안내만 한다', async () => {
  stubLookup()
  render(<MeContext value={me(['requester'])}><MemoryRouter initialEntries={['/sr']}><Markdown content={content} /><Probe /></MemoryRouter></MeContext>)
  await userEvent.click(screen.getByRole('button', { name: 'sr-2026-0002' }))
  await waitFor(() => expect(toastError).toHaveBeenCalledWith('SR-2026-0002 SR을 찾을 수 없거나 볼 권한이 없습니다'))
  expect(screen.getByLabelText('경로')).toHaveTextContent(/^\/sr$/)
  await userEvent.click(screen.getByRole('button', { name: 'SR-2026-0001' }))
  await waitFor(() => expect(screen.getByLabelText('경로')).toHaveTextContent('/sr?id=sr-1'))
})

it('S14: 라우터 밖(미리보기 등)에서는 SR 번호를 글자로만 둔다', () => {
  render(<Markdown content="SR-2026-0001 참고" />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.getByText(/SR-2026-0001/)).toBeInTheDocument()
})
