import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { RouteErrorPage } from './RouteErrorPage'

const reload = vi.fn()
beforeEach(() => { vi.stubGlobal('location', { ...window.location, reload }); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function renderWithError(error: Error, locale: 'ko' | 'en' = 'ko') {
  function Boom(): never { throw error }
  const router = createMemoryRouter([
    { path: '/', element: <div>home</div> },
    { path: '/broken', element: <Boom />, errorElement: <RouteErrorPage /> },
  ], { initialEntries: ['/broken'] })
  render(<I18nProvider locale={locale}><RouterProvider router={router} /></I18nProvider>)
  return router
}

it('모듈 로드 오류는 새 버전 안내와 새로고침 버튼을 보여 준다', async () => {
  renderWithError(new TypeError('Failed to fetch dynamically imported module: http://x/a.js'))
  expect(screen.getByRole('heading', { name: '새 버전이 있습니다' })).toBeInTheDocument()
  expect(screen.getByText('앱이 업데이트되어 이전 화면을 불러올 수 없습니다. 새로고침하면 새 버전으로 계속합니다.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '새로고침' }))
  expect(reload).toHaveBeenCalledOnce()
})

it('그 밖의 라우트 오류는 일반 안내와 홈 링크를 보여 준다', async () => {
  const router = renderWithError(new Error('boom'))
  expect(screen.getByRole('heading', { name: '화면을 표시할 수 없습니다' })).toBeInTheDocument()
  expect(screen.getByText('boom')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('link', { name: '홈으로' }))
  expect(router.state.location.pathname).toBe('/')
  expect(await screen.findByText('home')).toBeInTheDocument()
})

it('영문 문자열도 있다', () => {
  renderWithError(new TypeError('Importing a module script failed.'), 'en')
  expect(screen.getByRole('heading', { name: 'A new version is available' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Go home' })).toBeInTheDocument()
})
