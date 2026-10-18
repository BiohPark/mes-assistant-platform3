import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import { renderWithProviders } from '@/test/render'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MaterialsPicker } from './MaterialsPicker'

afterEach(() => vi.unstubAllGlobals())
it('groups SR body and attachments separately, searches sources, and never selects on opening', async () => {
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/candidates')) return Response.json({ files: [], srFiles: [{ file: { id: 'f', name: 'log.txt', version: 2 }, srId: 'sr', srCode: 'SR-1', srTitle: 'Pump' }], conversations: [] })
    if (url.endsWith('/sr-inputs')) return Response.json([{ srId: 'sr', code: 'SR-1', title: 'Pump', selected: false, used: true }])
    return Response.json([])
  })
  vi.stubGlobal('fetch', fetcher)
  const close = vi.fn()
  renderWithProviders(<MeContext value={{ id: 'u', name: 'User', roles: ['member'], role: '', email: null, emailIsDefault: false, theme: 'system', locale: 'ko' }}><TooltipProvider><MaterialsPicker task={{ id: 't', tags: [], inputs: [], status: 'in_progress' } as unknown as Task} onClose={close} onUpload={() => {}} /></TooltipProvider></MeContext>)
  const dialog = screen.getByRole('dialog')
  expect(await within(dialog).findByText('연결 SR 본문')).toBeVisible()
  await within(dialog).findByTestId('materials-sr-files')
  expect(within(dialog).getByTestId('materials-sr-files')).toHaveTextContent('연결 SR 첨부파일')
  expect(within(dialog).getByRole('button', { name: '+ 첨부 · SR-1' })).toBeVisible()
  expect(fetcher.mock.calls.every(([, init]) => !['PUT', 'PATCH', 'DELETE', 'POST'].includes(init?.method ?? 'GET'))).toBe(true)
  fireEvent.change(within(dialog).getByRole('textbox', { name: '자료 검색' }), { target: { value: 'log' } })
  expect(within(dialog).queryByTestId('sr-body-sr')).not.toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'log.txt v2' })).toBeVisible()
})

function renderPicker(status = 'in_progress') {
  const upload = vi.fn()
  const view = renderWithProviders(<MeContext value={{ id: 'u', name: 'User', roles: ['member'], role: '', email: null, emailIsDefault: false, theme: 'system', locale: 'ko' }}><TooltipProvider><MaterialsPicker task={{ id: 't', tags: [], inputs: [], status } as unknown as Task} onClose={() => {}} onUpload={upload} /></TooltipProvider></MeContext>)
  return { ...view, upload }
}
it('hides empty search sections, counts only matching conversations, and shows no results only when all sections are empty', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/candidates')) return Response.json({ files: [], srFiles: [], conversations: [
      { taskId: 'a', code: 'T-A', title: 'Pump', status: 'todo', assistant: { name: 'A' }, sharedTags: [], messageCount: 1, bytes: 1 },
      { taskId: 'b', code: 'T-B', title: 'Valve', status: 'todo', assistant: { name: 'A' }, sharedTags: [], messageCount: 1, bytes: 1 },
    ] })
    if (url.endsWith('/files')) return Response.json([{ id: 'f', name: 'manual.txt', version: 1, size: 10 }])
    return Response.json([])
  }))
  renderPicker()
  const dialog = screen.getByRole('dialog')
  await within(dialog).findByTestId('conversation-a')
  fireEvent.change(within(dialog).getByRole('textbox', { name: '자료 검색' }), { target: { value: 'manual' } })
  expect(within(dialog).queryByText(/맞는 자료가 없습니다/)).not.toBeInTheDocument()
  expect(within(dialog).queryByTestId('materials-shared')).not.toBeInTheDocument()
  expect(within(dialog).queryByTestId('conversation-candidates')).not.toBeInTheDocument()
  fireEvent.change(within(dialog).getByRole('textbox', { name: '자료 검색' }), { target: { value: 'Pump' } })
  expect(within(dialog).getByText('#태그 공유 대화 1개')).toBeVisible()
  expect(within(dialog).queryByTestId('materials-own')).not.toBeInTheDocument()
  fireEvent.change(within(dialog).getByRole('textbox', { name: '자료 검색' }), { target: { value: 'missing' } })
  expect(within(dialog).getByText(/missing/)).toBeVisible()
})
it('keeps PC upload first and enabled for a completed task while server selection stays disabled', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/files') ? [{ id: 'f', name: 'manual.txt', version: 1, size: 10 }] : url.endsWith('/candidates') ? { files: [], conversations: [] } : [])))
  const { container, upload } = renderPicker('done')
  const dialog = screen.getByRole('dialog')
  const button = within(dialog).getByRole('button', { name: '내 PC 파일 올리기' })
  expect(button).toBeEnabled()
  expect(within(dialog).getAllByRole('button')[0]).toBe(button)
  expect(await within(dialog).findByRole('button', { name: '+ 첨부 · manual.txt' })).toBeDisabled()
  fireEvent.change(container.ownerDocument.querySelector('[role="dialog"] input[type="file"]')!, { target: { files: [new File(['local'], 'local.txt')] } })
  expect(upload).toHaveBeenCalledOnce()
  expect(within(dialog).queryByText('#태그·SR 연결 자료')).not.toBeInTheDocument()
})
it('previews inside the picker without opening a nested modal', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/content') ? new Response('full original 104.25 mm') : Response.json(url.endsWith('/files') ? [{ id: 'f', name: 'manual.txt', version: 1, size: 10, mime: 'text/plain' }] : url.endsWith('/candidates') ? { files: [], conversations: [] } : [])))
  renderPicker()
  fireEvent.click(await screen.findByRole('button', { name: 'manual.txt v1' }))
  expect(await screen.findByText('full original 104.25 mm')).toBeVisible()
  expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1)
})
