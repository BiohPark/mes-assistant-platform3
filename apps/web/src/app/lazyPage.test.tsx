import { render, screen, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { createMemoryRouter, RouterProvider, useRouteError } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isModuleLoadError, lazyPage, RELOAD_MARK } from './lazyPage'

const reload = vi.fn()
beforeEach(() => { vi.stubGlobal('location', { ...window.location, reload }) })
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); vi.restoreAllMocks() })

type Module = { Page: () => React.ReactNode }
const chunkError = () => new TypeError('Failed to fetch dynamically imported module: http://localhost/assets/DraftConversationPage-abc.js')
const failing = (error: Error) => lazyPage(() => Promise.reject<Module>(error), (module) => module.Page)

function ThrownMessage() { return <div>thrown: {(useRouteError() as Error).message}</div> }
function renderInRouter(Page: React.ComponentType) {
  const router = createMemoryRouter([{ path: '/', element: <Suspense fallback={<span>loading</span>}><Page /></Suspense>, errorElement: <ThrownMessage /> }])
  render(<RouterProvider router={router} />)
}

it('첫 chunk 로드 실패는 표식을 남기고 한 번만 새로고침한다 — 오류를 던지지 않고 기다린다', async () => {
  renderInRouter(failing(chunkError()))
  await waitFor(() => expect(reload).toHaveBeenCalledOnce())
  expect(sessionStorage.getItem(RELOAD_MARK)).toBe('1')
  expect(screen.getByText('loading')).toBeInTheDocument()
  expect(screen.queryByText(/thrown/)).not.toBeInTheDocument()
})

it('표식이 있으면 다시 새로고침하지 않고 오류를 던진다', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  sessionStorage.setItem(RELOAD_MARK, '1')
  renderInRouter(failing(chunkError()))
  expect(await screen.findByText(/thrown: Failed to fetch dynamically imported module/)).toBeInTheDocument()
  expect(reload).not.toHaveBeenCalled()
})

it('정상 로드되면 표식을 지운다', async () => {
  sessionStorage.setItem(RELOAD_MARK, '1')
  const Page = lazyPage(() => Promise.resolve<Module>({ Page: () => <div>page</div> }), (module) => module.Page)
  renderInRouter(Page)
  expect(await screen.findByText('page')).toBeInTheDocument()
  expect(sessionStorage.getItem(RELOAD_MARK)).toBeNull()
  expect(reload).not.toHaveBeenCalled()
})

it('chunk 오류가 아니면 새로고침하지 않고 그대로 던진다', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  renderInRouter(failing(new Error('boom')))
  expect(await screen.findByText('thrown: boom')).toBeInTheDocument()
  expect(reload).not.toHaveBeenCalled()
  expect(sessionStorage.getItem(RELOAD_MARK)).toBeNull()
})

describe('isModuleLoadError', () => {
  it.each([
    new TypeError('Failed to fetch dynamically imported module: http://x/a.js'),
    new TypeError('error loading dynamically imported module: http://x/a.js'),
    new TypeError('Importing a module script failed.'),
    new Error('Unable to preload CSS for /assets/a.css'),
    Object.assign(new Error('Loading chunk 3 failed.'), { name: 'ChunkLoadError' }),
  ])('recognizes %s', (error) => {
    expect(isModuleLoadError(error)).toBe(true)
  })

  it.each([new Error('boom'), 'Failed to fetch dynamically imported module', null, undefined])('rejects %s', (error) => {
    expect(isModuleLoadError(error)).toBe(false)
  })
})
