import { screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { RequestInfoDialog } from './RequestInfoDialog'

afterEach(() => vi.unstubAllGlobals())

it('shows reference conversation mode and count and hides download without a snapshot', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { id: 'r', threadId: 'h', status: 'failed', model: 'mock', bytes: 0, limitBytes: 100,
    hasSnapshot: false, inputs: [{ kind: 'conversation', weight: 'reference', sourceLabel: 'WK-1', mode: 'messages', messageCount: 2, bytes: 10 }] })))
  renderWithProviders(<RequestInfoDialog requestId="r" onClose={() => undefined} />)
  expect(await screen.findByText(/메시지 선택 · 메시지 2개/)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '원본 JSON 다운로드' })).not.toBeInTheDocument()
})

it('offers the original JSON when a snapshot exists', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { id: 'r2', threadId: 'h', status: 'succeeded', model: 'mock', bytes: 1, limitBytes: 100,
    hasSnapshot: true, inputs: [] })))
  renderWithProviders(<RequestInfoDialog requestId="r2" onClose={() => undefined} />)
  expect(await screen.findByRole('link', { name: '원본 JSON 다운로드' })).toHaveAttribute('href', '/api/requests/r2/snapshot')
})
