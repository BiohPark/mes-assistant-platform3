import { screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { renderWithProviders, jsonResponse } from '@/test/render'
import { useModelList } from './useModelList'

afterEach(() => vi.unstubAllGlobals())
it('서버 모델 목록을 조회한다', async () => {
  const fetchMock = vi.fn(async () => jsonResponse(200, { models: ['fake-general'] }))
  vi.stubGlobal('fetch', fetchMock)
  function Probe() { const { models } = useModelList(); return <div>{models.join(',')}</div> }
  renderWithProviders(<Probe />)
  expect(await screen.findByText('fake-general')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith('/api/llm/models', { credentials: 'same-origin' })
})
it('502 응답은 빈 목록과 오류를 함께 노출한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(502, { message: 'failure' })))
  function Probe() { const { models, error } = useModelList(); return <div>{models.length}:{error?.message ?? 'no error'}</div> }
  renderWithProviders(<Probe />)
  expect(await screen.findByText('0:모델 목록 조회 실패 (HTTP 502)')).toBeInTheDocument()
})
