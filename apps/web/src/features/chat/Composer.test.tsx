import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRef } from 'react'
import { Composer, type ComposerHandle } from './Composer'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: toastSuccess } }))
afterEach(() => toastSuccess.mockClear())

function renderComposer(props: React.ComponentProps<typeof Composer>) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Composer {...props} /></QueryClientProvider>)
}

it('sends text to AI by default while team and file controls are unavailable', async () => {
  const send = vi.fn(async () => undefined)
  renderComposer({ streaming: false, onSend: send, onStop: () => undefined, allowAttachments: false })
  expect(screen.queryByRole('button', { name: '파일 첨부' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '팀 의견 (AI 미전송)' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '안녕하세요' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('안녕하세요', [], false))
})

it('keeps text during a failed send and clears it after a successful retry', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('실패')).mockResolvedValueOnce(undefined)
  renderComposer({ streaming: false, onSend: send, onStop: () => undefined })
  const input = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  fireEvent.change(input, { target: { value: '남길 의견' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(input).toHaveValue('남길 의견')
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(input).toHaveValue(''))
})

it('clears a drawer submission immediately and preserves text typed during the response', async () => {
  let finish!: () => void
  const send = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  renderComposer({ streaming: false, onSend: send, onStop: () => undefined, clearOnSubmit: true })
  const input = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  fireEvent.change(input, { target: { value: '첫 질문' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  expect(input).toHaveValue('')
  fireEvent.change(input, { target: { value: '다음 질문' } })
  finish()
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(input).toHaveValue('다음 질문')
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

it('defaults team-note attachments to this message only and keeps the choice after switching modes', async () => {
  const send = vi.fn(async () => undefined)
  const { container } = renderComposer({ streaming: false, onSend: send, onStop: () => undefined, allowAttachments: true, allowPin: true, allowDiscussion: true, placeholder: '도우미에게 요청하세요' })
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveAttribute('placeholder', '도우미에게 요청하세요')
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  expect(screen.getByRole('textbox', { name: '팀 의견 입력' })).toHaveAttribute('placeholder', '팀 의견을 남기세요 (AI에게 전송되지 않음)')
  const file = new File(['abc'], 'note.txt', { type: 'text/plain' })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
  expect(screen.getByText('이번 메시지만')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  expect(screen.getByText('이번 메시지만')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('', [{ file, once: true }], true))
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

it('accepts dropped files through the same limit and once rules as the attach button', async () => {
  const send = vi.fn(async () => undefined)
  const ref = createRef<ComposerHandle>()
  renderComposer({ ref, streaming: false, onSend: send, onStop: () => undefined, allowAttachments: true, allowPin: true, allowDiscussion: true, maxAttachments: 2 })
  const first = new File(['a'], 'first.txt', { type: 'text/plain' })
  let added = false
  act(() => { added = ref.current!.dropFiles([first]) })
  expect(added).toBe(true)
  expect(screen.getByText('first.txt')).toBeInTheDocument()
  expect(screen.getByText('입력으로 고정')).toBeInTheDocument()
  expect(toastSuccess).toHaveBeenCalledWith('1개 파일을 첨부 대기에 추가했습니다.')
  // 한도 초과면 아무것도 추가하지 않고 기존 메시지로 알린다
  act(() => { added = ref.current!.dropFiles([new File(['b'], 'b.txt'), new File(['c'], 'c.txt')]) })
  expect(added).toBe(false)
  expect(screen.getByRole('alert')).toHaveTextContent('첨부 파일은 최대 2개까지 선택할 수 있습니다.')
  expect(screen.queryByText('b.txt')).not.toBeInTheDocument()
  expect(toastSuccess).toHaveBeenCalledTimes(1)
  // 팀 의견 모드에서 놓으면 '이번 메시지만'
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  const second = new File(['d'], 'second.txt', { type: 'text/plain' })
  act(() => { added = ref.current!.dropFiles([second]) })
  expect(added).toBe(true)
  expect(screen.getByText('이번 메시지만')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('', [{ file: first, once: false }, { file: second, once: true }], true))
})


it('prefills only text, focuses the input and preserves discussion mode and attachments', async () => {
  const send = vi.fn(async () => undefined)
  const changed = vi.fn()
  const ref = createRef<ComposerHandle>()
  renderComposer({ ref, streaming: false, onSend: send, onStop: () => undefined, allowAttachments: true, allowPin: true, allowDiscussion: true, onDraftChange: changed })
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  const file = new File(['a'], 'current.txt')
  act(() => { ref.current!.dropFiles([file]); ref.current!.setText('**원문 질문**') })
  expect(screen.getByRole('textbox', { name: '팀 의견 입력' })).toHaveValue('**원문 질문**')
  expect(screen.getByRole('textbox', { name: '팀 의견 입력' })).toHaveFocus()
  expect(changed).toHaveBeenLastCalledWith('**원문 질문**')
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('**원문 질문**', [{ file, once: true }], true))
})

it('locks submission synchronously until the current send settles', async () => {
  let finish!: () => void
  const send = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  renderComposer({ streaming: false, onSend: send, onStop: () => undefined })
  const input = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  fireEvent.change(input, { target: { value: '질문' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  expect(send).toHaveBeenCalledTimes(1)
  await act(async () => finish())
})
