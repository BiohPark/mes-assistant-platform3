import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { FileList } from './FileList'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }))
afterEach(() => { vi.unstubAllGlobals(); toastError.mockClear() })

it('shows the server reason when deletion is blocked by another task input', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(409, { message: '다른 대화에서 입력으로 사용 중' })))
  renderWithProviders(<FileList files={[{ id: 'f', originTaskId: 't', name: 'report.txt', mime: 'text/plain', size: 1, sha256: 'x', source: 'upload', isOutput: false, version: 1, uploadedBy: 'u', uploadedAt: '2026-01-01T00:00:00.000Z' }]} taskId="t" />)
  fireEvent.click(screen.getByRole('button', { name: '삭제' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '삭제' }))
  await waitFor(() => expect(toastError).toHaveBeenCalledWith('다른 대화에서 입력으로 사용 중'))
})

const meta = { id: 'f', originTaskId: 't', name: 'report.txt', mime: 'text/plain', size: 1, sha256: 'x', source: 'assistant' as const, isOutput: true, version: 1, uploadedBy: 'u', uploadedAt: '2026-01-01T00:00:00.000Z' }

it('renders the file name as plain text without a preview handler and keeps 32px action targets', () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [])))
  renderWithProviders(<FileList files={[meta]} taskId="t" onToggleOutput={() => undefined} />)
  expect(screen.queryByRole('button', { name: /report.txt v1/ })).not.toBeInTheDocument()
  expect(screen.getByText('report.txt v1').tagName).toBe('SPAN')
  for (const name of ['산출물 해제', '버전 기록', '다운로드', '삭제']) expect(screen.getByRole('button', { name })).toHaveClass('size-8')
  expect(screen.getByText('에이전트')).toHaveClass('bg-tone-violet-bg', 'text-tone-violet-fg')
  expect(screen.getByTestId('file-f').innerHTML).not.toMatch(/(?:bg|text|border|fill)-(?:amber|violet|sky)-\d/)
})

it('renders the file name as a button when a preview handler is given', () => {
  const onPreview = vi.fn()
  renderWithProviders(<FileList files={[meta]} taskId="t" onPreview={onPreview} />)
  fireEvent.click(screen.getByRole('button', { name: 'report.txt v1' }))
  expect(onPreview).toHaveBeenCalledWith(meta)
})
