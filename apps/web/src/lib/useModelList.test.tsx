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
