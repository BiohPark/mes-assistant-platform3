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
