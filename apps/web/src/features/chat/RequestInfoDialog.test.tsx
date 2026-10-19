import userEvent from '@testing-library/user-event'
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

it('shows URL, source bytes, redirect target and read failure in used materials', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { id: 'web', status: 'succeeded', model: 'm', bytes: 100, limitBytes: 1000, hasSnapshot: true, inputs: [],
    webPages: [{ url: 'https://intra.test/', finalUrl: 'https://intra.test/doc', bytes: 42, status: 'read' }, { url: 'https://blocked.test/', bytes: 0, status: 'failed', error: '차단된 주소' }] })))
  renderWithProviders(<RequestInfoDialog requestId="web" onClose={() => undefined} />)
  expect(await screen.findByRole('link', { name: 'https://intra.test/' })).toHaveAttribute('href', 'https://intra.test/')
  expect(screen.getByText(/42 bytes · 읽음/)).toBeInTheDocument()
  expect(screen.getByText(/읽지 못함\(차단된 주소\)/)).toBeInTheDocument()
  expect(screen.getByText('→ https://intra.test/doc')).toBeInTheDocument()
})

it('loads raw response on demand and compares raw JSON, steps and screen body with JSON copying', async () => {
  const user = userEvent.setup()
  const raw = { mode: 'session', message: { content: '<details type="reasoning">think</details>answer' } }
  const fetcher = vi.fn(async (url: string) => jsonResponse(200, url.endsWith('/response') ? { rawResponse: raw, steps: [{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'answer' }], content: 'answer', reasoning: 'think' }
    : { id: 'raw', status: 'succeeded', model: 'm', bytes: 1, limitBytes: 100, hasSnapshot: true, canViewRawResponse: true, inputs: [] }))
  vi.stubGlobal('fetch', fetcher)
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  renderWithProviders(<RequestInfoDialog requestId="raw" onClose={() => undefined} />)
  await user.click(await screen.findByRole('button', { name: '응답 원문 보기' }))
  expect(await screen.findByText('원문')).toBeVisible()
  expect(screen.getByText('파싱된 steps')).toBeVisible()
  expect(screen.getByText('화면 본문')).toBeVisible()
  expect(screen.getByTestId('raw-response-json')).toHaveTextContent('<details')
  expect(screen.getByTestId('response-body')).toHaveTextContent('answer')
  await user.click(screen.getByRole('button', { name: 'JSON 복사' }))
  expect(JSON.parse(copy.mock.calls[0]![0])).toMatchObject({ rawResponse: raw, content: 'answer' })
})
it('does not offer raw response diagnostics to unauthorized viewers', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { id: 'r', status: 'succeeded', inputs: [], canViewRawResponse: false })))
  renderWithProviders(<RequestInfoDialog requestId="r" onClose={() => undefined} />)
  await screen.findByText(/완료/)
  expect(screen.queryByRole('button', { name: '응답 원문 보기' })).not.toBeInTheDocument()
})
