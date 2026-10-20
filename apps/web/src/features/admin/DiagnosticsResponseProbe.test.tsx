import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { ResponseProbeCard } from './DiagnosticsResponseProbe'

const result = { rawResponse: { mode: 'session', message: { content: '<details>thought</details>answer' } },
  steps: [{ type: 'reasoning', text: 'thought' }, { type: 'code', code: 'echo hi', output: 'hi', status: 'done' },
    { type: 'tool', name: 'search', input: '{}', output: 'found', status: 'done' }, { type: 'text', text: 'answer' }],
  content: 'answer', mode: 'session', model: 'agent-b', elapsedMs: 12 }
afterEach(() => vi.unstubAllGlobals())
it('selects the existing model list, shows progress, all three columns, and copies full JSON', async () => {
  let resolve: (value: Response) => void = () => undefined
  const writes: string[] = []
  vi.stubGlobal('navigator', { clipboard: { writeText: async (text: string) => { writes.push(text) } } })
  const fetcher = vi.fn(async (url: string) => url === '/api/llm/models' ? jsonResponse(200, { models: ['agent-a', 'agent-b'] }) : new Promise<Response>(r => { resolve = r }))
  vi.stubGlobal('fetch', fetcher)
  renderWithProviders(<ResponseProbeCard live defaultModel="agent-a" />)
  const card = screen.getByRole('region', { name: '응답 원문 진단' })
  fireEvent.change(within(card).getByRole('combobox'), { target: { value: 'agent-b' } })
  fireEvent.click(within(card).getByRole('button', { name: '진단 실행' }))
  expect(await within(card).findByRole('button', { name: /진단 중/ })).toBeDisabled()
  expect(fetcher).toHaveBeenCalledWith('/api/admin/diagnostics/openwebui/response-probe', expect.objectContaining({ body: JSON.stringify({ model: 'agent-b' }) }))
  resolve(jsonResponse(200, result))
  expect(await within(card).findByTestId('raw-response-json')).toHaveTextContent('<details>')
  expect(within(card).getByTestId('parsed-steps')).toHaveTextContent('reasoning')
  expect(within(card).getByTestId('parsed-steps')).toHaveTextContent('code')
  expect(within(card).getByTestId('parsed-steps')).toHaveTextContent('tool')
  expect(within(card).getByTestId('response-body')).toHaveTextContent('answer')
  expect(within(card).getByRole('status')).toHaveTextContent('session · agent-b · 12 ms')
  fireEvent.click(within(card).getByRole('button', { name: 'JSON 복사' }))
  await waitFor(() => expect(JSON.parse(writes[0]!)).toEqual(result))
})
it('disables mock runs and displays provider failures', async () => {
  vi.stubGlobal('fetch', async (url: string) => url === '/api/llm/models' ? jsonResponse(200, { models: ['agent-a'] }) : jsonResponse(504, { message: 'failed' }))
  const { unmount } = renderWithProviders(<ResponseProbeCard live={false} defaultModel="agent-a" />)
  expect(screen.getByRole('button', { name: '진단 실행' })).toBeDisabled()
  unmount()
  renderWithProviders(<ResponseProbeCard live defaultModel="agent-a" />)
  fireEvent.click(screen.getByRole('button', { name: '진단 실행' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('failed')
})
