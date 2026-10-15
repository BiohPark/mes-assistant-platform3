import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRef, useState } from 'react'
import { Composer, type ComposerHandle } from './Composer'
import { clearDrafts, getDraft } from './drafts'

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

it('renders the toolbar under the textarea with tools next to the attach button and send on the right', () => {
  renderComposer({ streaming: false, onSend: vi.fn(async () => undefined), onStop: () => undefined, allowAttachments: true, allowDiscussion: true, tools: <output>모델 선택</output> })
  const textarea = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  const toolbar = screen.getByRole('button', { name: '파일 첨부' }).parentElement!
  expect(textarea.nextElementSibling).toBe(toolbar)
  expect(textarea).toHaveClass('w-full')
  expect(toolbar.parentElement).toHaveClass('rounded-xl', 'border')
  const order = Array.from(toolbar.children).map(child => child.getAttribute('aria-label') ?? child.tagName.toLowerCase())
  expect(order.filter(item => item !== 'input')).toEqual(['파일 첨부', 'output', 'span', '팀 의견 (AI 미전송)', '전송'])
  expect(screen.getByText('모델 선택')).toBeInTheDocument()
})

it('sends AI attachments without a pinning toggle', async () => {
  const send = vi.fn(async () => undefined)
  const { container } = renderComposer({ streaming: false, onSend: send, onStop: () => undefined, allowAttachments: true })
  const file = new File(['abc'], 'note.txt', { type: 'text/plain' })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
  expect(screen.getByText('note.txt')).toBeVisible()
  expect(screen.queryByRole('button', { name: /입력으로 고정|이번 메시지만/ })).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: '첨부 제거' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('', [{ file }], false))
})

it.each([false, true])('preserves attachments across mode switches and sends in the final mode (discussion=%s)', async (discussion) => {
  const send = vi.fn(async () => undefined)
  const { container } = renderComposer({ streaming: false, onSend: send, onStop: () => undefined, allowAttachments: true, allowDiscussion: true, placeholder: '도우미에게 요청하세요' })
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveAttribute('placeholder', '도우미에게 요청하세요')
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  expect(screen.getByRole('textbox', { name: '팀 의견 입력' })).toHaveAttribute('placeholder', '팀 의견을 남기세요 (AI에게 전송되지 않음)')
  const file = new File(['abc'], 'note.txt', { type: 'text/plain' })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
  expect(screen.getByText('note.txt')).toBeVisible()
  expect(screen.queryByRole('button', { name: /입력으로 고정|이번 메시지만/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  expect(screen.getByText('note.txt')).toBeVisible()
  expect(screen.queryByRole('button', { name: /입력으로 고정|이번 메시지만/ })).not.toBeInTheDocument()
  if (discussion) fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('', [{ file }], discussion))
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

it('accepts dropped files through the same limit as the attach button', async () => {
  const send = vi.fn(async () => undefined)
  const ref = createRef<ComposerHandle>()
  renderComposer({ ref, streaming: false, onSend: send, onStop: () => undefined, allowAttachments: true, allowDiscussion: true, maxAttachments: 2 })
  const first = new File(['a'], 'first.txt', { type: 'text/plain' })
  let added = false
  act(() => { added = ref.current!.dropFiles([first]) })
  expect(added).toBe(true)
  expect(screen.getByText('first.txt')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /입력으로 고정|이번 메시지만/ })).not.toBeInTheDocument()
  expect(toastSuccess).toHaveBeenCalledWith('1개 파일을 첨부 대기에 추가했습니다.')
  // 한도 초과면 아무것도 추가하지 않고 기존 메시지로 알린다
  act(() => { added = ref.current!.dropFiles([new File(['b'], 'b.txt'), new File(['c'], 'c.txt')]) })
  expect(added).toBe(false)
  expect(screen.getByRole('alert')).toHaveTextContent('첨부 파일은 최대 2개까지 선택할 수 있습니다.')
  expect(screen.queryByText('b.txt')).not.toBeInTheDocument()
  expect(toastSuccess).toHaveBeenCalledTimes(1)
  // 팀 의견 모드에서도 전환 버튼 없이 첨부를 추가한다
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  const second = new File(['d'], 'second.txt', { type: 'text/plain' })
  act(() => { added = ref.current!.dropFiles([second]) })
  expect(added).toBe(true)
  expect(screen.getByText('second.txt')).toBeVisible()
  expect(screen.queryByRole('button', { name: /입력으로 고정|이번 메시지만/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('', [{ file: first }, { file: second }], true))
})


it('prefills only text, focuses the input and preserves discussion mode and attachments', async () => {
  const send = vi.fn(async () => undefined)
  const changed = vi.fn()
  const ref = createRef<ComposerHandle>()
  renderComposer({ ref, streaming: false, onSend: send, onStop: () => undefined, allowAttachments: true, allowDiscussion: true, onDraftChange: changed })
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  const file = new File(['a'], 'current.txt')
  act(() => { ref.current!.dropFiles([file]); ref.current!.setText('**원문 질문**') })
  expect(screen.getByRole('textbox', { name: '팀 의견 입력' })).toHaveValue('**원문 질문**')
  expect(screen.getByRole('textbox', { name: '팀 의견 입력' })).toHaveFocus()
  expect(changed).toHaveBeenLastCalledWith('**원문 질문**')
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('**원문 질문**', [{ file }], true))
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

it('restores text, attachments and the discussion mode saved under the same draft key, and starts empty for another key', async () => {
  const noop = async () => undefined
  const first = renderComposer({ streaming: false, onSend: noop, onStop: () => undefined, allowAttachments: true, allowDiscussion: true, draftKey: 'draft-a' })
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '남길 초안' } })
  fireEvent.change(first.container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'keep.txt', { type: 'text/plain' })] } })
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  expect(screen.getByRole('textbox', { name: '팀 의견 입력' })).toHaveValue('남길 초안')
  first.unmount()
  const other = renderComposer({ streaming: false, onSend: noop, onStop: () => undefined, allowAttachments: true, allowDiscussion: true, draftKey: 'draft-b' })
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('')
  expect(screen.queryByText('keep.txt')).not.toBeInTheDocument()
  other.unmount()
  renderComposer({ streaming: false, onSend: noop, onStop: () => undefined, allowAttachments: true, allowDiscussion: true, draftKey: 'draft-a' })
  expect(screen.getByRole('textbox', { name: '팀 의견 입력' })).toHaveValue('남길 초안')
  expect(screen.getByText('keep.txt')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' })).toHaveAttribute('aria-pressed', 'true')
  clearDrafts()
})

function RaceHarness({ composer }: { composer: React.RefObject<ComposerHandle | null> }) {
  const [epoch, setEpoch] = useState(0)
  const noop = async () => undefined
  // 첨부 추가와 재마운트(key 변경)가 같은 이벤트 핸들러 = 같은 렌더 배치에 들어오는 경우
  return <>
    <button type="button" onClick={() => { composer.current?.dropFiles([new File(['x'], 'race.txt', { type: 'text/plain' })]); setEpoch((value) => value + 1) }}>첨부와 재마운트</button>
    <span data-testid="epoch">{epoch}</span>
    <Composer key={epoch} ref={composer} draftKey="draft-race" streaming={false} onSend={noop} onStop={() => undefined} allowAttachments allowDiscussion />
  </>
}

it('keeps a staged attachment when the composer remounts in the same batch as the attach, and the prefill afterwards', async () => {
  const composer = createRef<ComposerHandle>()
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RaceHarness composer={composer} /></QueryClientProvider>)
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '보호할 초안' } })
  fireEvent.click(screen.getByRole('button', { name: '첨부와 재마운트' }))
  expect(screen.getByTestId('epoch')).toHaveTextContent('1')
  expect(screen.getByText('race.txt')).toBeInTheDocument() // 재마운트된 인스턴스가 방금 붙인 첨부를 복원한다
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('보호할 초안')
  act(() => composer.current!.setText('**기존 질문**')) // 프리필
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('**기존 질문**')
  expect(screen.getByRole('button', { name: '첨부 제거' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '첨부와 재마운트' }))
  expect(screen.getAllByRole('button', { name: '첨부 제거' })).toHaveLength(2) // 두 번째 첨부도 유지
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('**기존 질문**')
  clearDrafts()
})

it('clears only what was sent: text and attachments staged while the send was still resolving survive', async () => {
  let finish!: () => void
  const send = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  const { container } = renderComposer({ streaming: false, onSend: send, onStop: () => undefined, allowAttachments: true, allowDiscussion: true })
  const input = () => screen.getByRole('textbox', { name: /입력/ })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'sent.txt', { type: 'text/plain' })] } })
  fireEvent.change(input(), { target: { value: '보낼 질문' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledWith('보낼 질문', [expect.objectContaining({ file: expect.objectContaining({ name: 'sent.txt' }) })], false))
  // 응답이 화면에서 끝난 뒤에도 onSend 약속은 조금 늦게 풀린다 — 그 사이 사용자가 다음 메시지를 준비한다
  fireEvent.click(screen.getByRole('button', { name: '팀 의견 (AI 미전송)' }))
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['b'], 'next.txt', { type: 'text/plain' })] } })
  expect(screen.getAllByRole('button', { name: '첨부 제거' })).toHaveLength(2)
  await act(async () => { finish() })
  expect(screen.queryByText('sent.txt')).not.toBeInTheDocument()
  expect(screen.getByText('next.txt')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '첨부 제거' })).toBeVisible()
  expect(input()).toHaveValue('') // 보낸 텍스트는 그대로였으니 비운다
  fireEvent.change(input(), { target: { value: '다음 질문' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  fireEvent.change(input(), { target: { value: '다음 질문을 고친다' } })
  await act(async () => { finish() })
  expect(input()).toHaveValue('다음 질문을 고친다') // 보내는 동안 고친 텍스트는 남긴다
})

it('drops the sent text and attachments from the draft at submit time, so a conversation revisited during streaming starts empty and the late completion does not erase the new draft', async () => {
  let finish!: () => void
  const send = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  const noop = async () => undefined
  const first = renderComposer({ streaming: false, onSend: send, onStop: () => undefined, allowAttachments: true, draftKey: 'draft-sent' })
  fireEvent.change(first.container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'q1.txt', { type: 'text/plain' })] } })
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: 'Q1' } })
  expect(getDraft('draft-sent')).toMatchObject({ text: 'Q1' })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('Q1') // 보내는 동안 화면은 그대로
  expect(getDraft('draft-sent')).toBeUndefined() // 하지만 초안에서는 보낸 부분이 빠진다
  first.unmount() // 응답 중 다른 대화로 전환
  const second = renderComposer({ streaming: true, onSend: noop, onStop: () => undefined, allowAttachments: true, draftKey: 'draft-sent' })
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('') // 돌아와도 Q1이 되살아나지 않는다
  expect(screen.queryByText('q1.txt')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: '다음 질문' } })
  await act(async () => { finish() }) // 옛 인스턴스의 전송이 끝나도
  expect(getDraft('draft-sent')).toMatchObject({ text: '다음 질문' }) // 새 초안을 지우지 않는다
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('다음 질문')
  second.unmount()
  clearDrafts()
})

it('puts the sent draft back when the send fails, so switching away keeps it', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('실패'))
  const view = renderComposer({ streaming: false, onSend: send, onStop: () => undefined, draftKey: 'draft-failed' })
  fireEvent.change(screen.getByRole('textbox', { name: 'AI 요청 입력' }), { target: { value: 'Q1' } })
  fireEvent.click(screen.getByRole('button', { name: '전송' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(getDraft('draft-failed')).toMatchObject({ text: 'Q1' }))
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('Q1')
  view.unmount()
  clearDrafts()
})

it('S14: 자료함 첨부와 직접 올린 파일이 입력창 위 한 줄의 칩으로 보이고 ×로 뺀다(투어 앵커는 칩 줄, 없으면 📎)', () => {
  const removeFile = vi.fn(), toggleMain = vi.fn(), removeConversation = vi.fn(), removeSr = vi.fn()
  const props = { streaming: false, onSend: vi.fn(async () => undefined), onStop: () => undefined, allowAttachments: true }
  const view = renderComposer({ ...props, attachments: [] })
  expect(screen.queryByRole('list', { name: '첨부' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '파일 첨부' })).toHaveAttribute('data-tour', 'materials-staged')
  view.unmount()
  const { container } = renderComposer({ ...props, notice: <p>한도 근처</p>, attachments: [
    { key: 'f', kind: 'file', label: 'spec.txt', title: 'spec.txt v1 · 첨부', main: false, onToggleMain: toggleMain, onRemove: removeFile },
    { key: 'c', kind: 'conversation', label: 'WK-2026-0002', title: '원본 대화', onRemove: removeConversation },
    { key: 's', kind: 'sr', label: 'SR-2026-0001', title: '알람 필터', onRemove: removeSr },
  ] })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'direct.txt')] } })
  const row = screen.getByRole('list', { name: '첨부' })
  expect(row).toHaveAttribute('data-tour', 'materials-staged')
  expect(screen.getByRole('button', { name: '파일 첨부' })).not.toHaveAttribute('data-tour')
  expect(Array.from(row.children).map(item => item.textContent)).toEqual(['spec.txt', 'WK-2026-0002', 'SR-2026-0001', 'direct.txt'])
  expect(row.children[0]).toHaveAttribute('title', 'spec.txt v1 · 첨부')
  // 직접 올린 파일의 ×는 '첨부 제거', 자료함 첨부의 ×는 '{이름} 첨부 빼기'
  expect(screen.getAllByRole('button', { name: '첨부 제거' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'spec.txt 첨부 빼기' }))
  fireEvent.click(screen.getByRole('button', { name: 'WK-2026-0002 첨부 빼기' }))
  fireEvent.click(screen.getByRole('button', { name: 'SR-2026-0001 첨부 빼기' }))
  expect([removeFile, removeConversation, removeSr].map(fn => fn.mock.calls.length)).toEqual([1, 1, 1])
  fireEvent.click(screen.getByRole('button', { name: 'spec.txt 주 입력 전환' }))
  expect(toggleMain).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: 'SR-2026-0001 주 입력 전환' })).not.toBeInTheDocument()
  // 안내(요청 크기)는 칩 아래·입력창 위
  expect(row.compareDocumentPosition(screen.getByText('한도 근처')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByText('한도 근처').compareDocumentPosition(screen.getByRole('textbox')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('S14: 비활성 칩은 ★·×를 막고 실패 칩은 경고색이다', () => {
  renderComposer({ streaming: false, onSend: vi.fn(async () => undefined), onStop: () => undefined, attachments: [
    { key: 'f', kind: 'file', label: 'bad.bin', main: true, onToggleMain: vi.fn(), onRemove: vi.fn(), disabled: true, danger: true },
  ] })
  expect(screen.getByRole('button', { name: 'bad.bin 주 입력 전환' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'bad.bin 주 입력 전환' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'bad.bin 첨부 빼기' })).toBeDisabled()
  expect(screen.getByRole('listitem')).toHaveClass('text-destructive')
})
