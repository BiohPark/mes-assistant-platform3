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


it.each([
  { mode: 'tools', tool_ids: ['lookup'], features: { web_search: true } },
  { mode: 'fallback' }, { mode: 'basic' },
])('shows only tools and features actually dispatched: %j', async owuiTools => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { id: 'tools', status: 'succeeded', model: 'm', bytes: 1, limitBytes: 100, hasSnapshot: true, inputs: [], owuiTools })))
  renderWithProviders(<RequestInfoDialog requestId="tools" onClose={() => undefined} />)
  expect(await screen.findByText({ tools: '도구 전달', fallback: '폴백 (기본 방식)', basic: '기본 방식' }[owuiTools.mode]!)).toBeInTheDocument()
  if (owuiTools.mode === 'tools') {
    expect(screen.getByText(/tool_ids:.*lookup/)).toBeInTheDocument()
    expect(screen.getByText(/features:.*web_search/)).toBeInTheDocument()
  } else expect(screen.queryByText(/lookup|web_search/)).not.toBeInTheDocument()
})
