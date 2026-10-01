import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Composer } from './Composer'

function renderComposer(props: React.ComponentProps<typeof Composer>) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Composer {...props} /></QueryClientProvider>)
}

it('sends text to AI by default while team and file controls are unavailable', async () => {
  const send = vi.fn(async () => undefined)
  renderComposer({ streaming: false, onSend: send, onStop: () => undefined, allowAttachments: false })
  expect(screen.queryByRole('button', { name: '파일 첨부' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '팀 의견 (AI 미전송)' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: '팀 의견 입력' }), { target: { value: '안녕하세요' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('안녕하세요', [], false))
})

it('keeps text during a failed send and clears it after a successful retry', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('실패')).mockResolvedValueOnce(undefined)
  renderComposer({ streaming: false, onSend: send, onStop: () => undefined })
  const input = screen.getByRole('textbox', { name: '팀 의견 입력' })
  fireEvent.change(input, { target: { value: '남길 의견' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(input).toHaveValue('남길 의견')
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(input).toHaveValue(''))
})

it('pins attachments by default and lets a sender mark one as message-only', async () => {
  const send = vi.fn(async () => undefined)
  const { container } = renderComposer({ streaming: false, onSend: send, onStop: () => undefined, allowAttachments: true, allowPin: true })
  const file = new File(['abc'], 'note.txt', { type: 'text/plain' })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
  expect(screen.getByText('입력으로 고정')).toBeInTheDocument()
  fireEvent.click(screen.getByText('입력으로 고정'))
  expect(screen.getByText('이번 메시지만')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('', [{ file, once: true }], false))
})

it('rejects more than 20 attachments before sending', async () => {
  const send = vi.fn(async () => undefined)
  const { container } = renderComposer({ streaming: false, onSend: send, onStop: () => undefined, allowAttachments: true })
  const files = Array.from({ length: 21 }, (_, index) => new File(['x'], `f${index}.txt`))
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } })
  expect(screen.getByRole('alert')).toHaveTextContent('20')
  expect(screen.queryByText('f0.txt')).not.toBeInTheDocument()
  expect(send).not.toHaveBeenCalled()
})
