import { useState } from 'react'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { TaskBody } from './TaskBody'
import { useTaskChatActions } from './chatActions'
import { TaskHeader } from './TaskHeader'
import { inputSelection } from '@/api/inputSelection'
import { useMaterialsDrawer } from './materialsDrawer'
import { useTagShareStore } from './tagShare'
import { emitEvent } from '@/app/useEvents'
import { TabActiveContext } from '@/app/tabActive'
import { createT } from '@/i18n'
import { focusPageTarget } from '@/features/assistant-pill/pageActions'

const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' } satisfies Task

afterEach(() => { cleanup(); vi.useRealTimers(); inputSelection.setState({ byTask: {} }); vi.unstubAllGlobals(); sessionStorage.clear(); useMaterialsDrawer.setState({ byTask: {} }); useTagShareStore.setState({ byTask: {} }) })

function stub() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    if (url.endsWith('/candidates')) return jsonResponse(200, { files: [], conversations: [] })
    if (url.endsWith('/activity')) return jsonResponse(200, [{ id: 'event', taskId: 't', userId: 'u', type: 'task.reopened', payload: { reason: '추가 확인' }, at: task.createdAt }])
    return jsonResponse(200, [])
  }))
}
const assistant = { id: 'a', name: '도우미' } as Assistant
const me = { id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }
function view(value: Task) { return <MeContext value={me}><TooltipProvider><TaskHeader task={value} assistant={assistant} /><TaskBody task={value} assistant={assistant} /></TooltipProvider></MeContext> }

// Missing badge updates, automatic opening and state loss are observable regressions.
it('레일 네 입구·배지와 헤더 정리, 후보 유입은 배지만 갱신하고 자료 열람으로 해제한다', async () => {
  let ids = ['one', 'two']
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/candidate-count')) return jsonResponse(200, { count: ids.length })
    if (url.endsWith('/candidates')) return jsonResponse(200, { files: [], conversations: ids.map(id => ({ taskId: id, code: id, title: id, status: 'in_progress', assistant: { id: 'a', name: '도우미', color: 'blue' }, sharedTags: ['A'], messageCount: 0, bytes: 0, lastActivityAt: task.createdAt })) })
    if (url.endsWith('/notes')) return jsonResponse(200, [{ id: 'n', authorId: 'u', content: '기존 메모', attachmentIds: [], createdAt: task.createdAt }])
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    return jsonResponse(200, [])
  }))
  renderWithProviders(view({ ...task, tags: ['A'], checklist: [{ id: 'c', label: '필수', checked: false, required: true }] }))
  const rail = screen.getByRole('navigation', { name: '업무 도구' })
  expect(within(rail).getAllByRole('button')).toHaveLength(4)
  const materials = within(rail).getByRole('button', { name: /자료/ })
  expect(await within(materials).findByText('새 2')).toBeVisible()
  expect(materials).toHaveAttribute('aria-pressed', 'false')
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^연결 자료(?:\(\d+\))?$/ })).not.toBeInTheDocument()
  expect(within(rail).getByText('0/1')).toHaveClass('text-tone-warning-fg')
  expect(await within(rail).findByText('1')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '더 보기' }))
  for (const name of ['체크리스트 열기', '메모 열기', '활동 이력 열기']) expect(screen.queryByRole('menuitem', { name })).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  fireEvent.click(materials)
  expect(materials).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('tablist', { name: '보조 패널' })).toBeVisible()
  await waitFor(() => expect(within(materials).queryByText(/새 /)).not.toBeInTheDocument())
  fireEvent.click(materials)
  expect(materials).toHaveFocus()
  ids = ['one', 'three'] // same count, different unseen candidate
  act(() => emitEvent({ event: 'task.updated', data: { taskId: 'source' } }))
  expect(await within(materials).findByText('새 1')).toBeVisible()
  expect(materials).toHaveAttribute('aria-pressed', 'false')
})

it('탭 전환·접기는 인스턴스를 유지하고 MDI 퇴거 후 세션에서 탭·펼침·초안·첨부·스크롤을 복원한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/files')) return jsonResponse(200, [{ id: 'f', name: '메모.txt', version: 1 }])
    if (url.endsWith('/candidates')) return jsonResponse(200, { files: [], conversations: [] })
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    return jsonResponse(200, [])
  }))
  const first = renderWithProviders(view(task))
  expect(screen.getByRole('button', { name: '메모' })).toHaveTextContent('메모')
  fireEvent.click(screen.getByRole('button', { name: '메모' }))
  const memo = screen.getByRole('textbox', { name: '메모 본문' })
  fireEvent.change(memo, { target: { value: '보존할 메모' } })
  fireEvent.click(await screen.findByRole('checkbox', { name: '메모.txt v1' }))
  const panel = screen.getByRole('tabpanel', { name: '메모' })
  fireEvent.scroll(panel, { target: { scrollTop: 137 } })
  fireEvent.click(screen.getByRole('tab', { name: '체크' }))
  expect(panel).toHaveAttribute('hidden')
  fireEvent.change(screen.getByRole('textbox', { name: '체크리스트 새 항목' }), { target: { value: '검토할 항목' } })
  fireEvent.click(screen.getByRole('tab', { name: '메모' }))
  expect(screen.getByRole('textbox', { name: '메모 본문' })).toBe(memo)
  fireEvent.click(screen.getByRole('button', { name: '접기' }))
  expect(screen.getByRole('button', { name: '메모' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: '메모' }))
  first.unmount()
  useMaterialsDrawer.setState({ byTask: {} }) // simulate session recovery, not only retained memory
  const second = renderWithProviders(view(task))
  expect(screen.getByRole('tab', { name: '메모' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('textbox', { name: '메모 본문' })).toHaveValue('보존할 메모')
  expect(await screen.findByRole('checkbox', { name: '메모.txt v1' })).toBeChecked()
  expect(screen.getByRole('tabpanel', { name: '메모' }).scrollTop).toBe(137)
  fireEvent.click(screen.getByRole('tab', { name: '체크' }))
  expect(screen.getByRole('textbox', { name: '체크리스트 새 항목' })).toHaveValue('검토할 항목')
  second.unmount()
  renderWithProviders(view({ ...task, id: 'second', threadId: 'second-thread' }))
  fireEvent.click(screen.getByRole('button', { name: '메모' }))
  expect(screen.getByRole('textbox', { name: '메모 본문' })).toHaveValue('')
})

it('펼친 상단 탭을 다시 누르면 레일로 접히고 그 레일 입구로 포커스가 간다', async () => {
  stub()
  renderWithProviders(view(task))
  fireEvent.click(screen.getByRole('button', { name: '메모' }))
  fireEvent.click(screen.getByRole('tab', { name: '체크' }))
  expect(screen.getByRole('tab', { name: '체크' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(screen.getByRole('tab', { name: '체크' }))
  expect(screen.queryByRole('tablist', { name: '보조 패널' })).not.toBeInTheDocument()
  expect(within(screen.getByRole('navigation', { name: '업무 도구' })).getByRole('button', { name: /^체크/ })).toHaveFocus()
})

it('필수 누락은 색만이 아니라 체크 입구의 접근 가능한 설명에 건수로 알린다', () => {
  stub()
  renderWithProviders(view({ ...task, checklist: [{ id: 'a', label: '필수1', checked: false, required: true }, { id: 'b', label: '필수2', checked: false, required: true }, { id: 'c', label: '선택', checked: false, required: false }] }))
  const entry = within(screen.getByRole('navigation', { name: '업무 도구' })).getByRole('button', { name: /^체크/ })
  expect(entry).toHaveAccessibleDescription('필수 2건 미완료')
  cleanup()
  renderWithProviders(view({ ...task, checklist: [{ id: 'c', label: '선택', checked: false, required: false }] }))
  expect(within(screen.getByRole('navigation', { name: '업무 도구' })).getByRole('button', { name: /^체크/ })).not.toHaveAccessibleDescription(/필수/)
})

it('가이드 투어가 자료를 펼쳐도 투어 말풍선의 포커스를 빼앗지 않는다', async () => {
  stub()
  renderWithProviders(<>{view(task)}<div role="dialog" aria-label="투어" tabIndex={-1}>말풍선</div></>)
  const card = screen.getByRole('dialog', { name: '투어' })
  act(() => { focusPageTarget('materials', createT('ko')); card.focus() })
  expect(screen.getByRole('tablist', { name: '보조 패널' })).toBeVisible()
  await act(async () => {})
  expect(card).toHaveFocus()
})

it('1024px 미만은 하단 네 칸 바와 시트, Escape 닫기는 진입점으로 포커스를 돌린다', async () => {
  stub()
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addListener() {}, removeListener() {} }))
  renderWithProviders(view({ ...task, tags: ['A'] }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const entry = screen.getByRole('button', { name: '메모' })
  expect(screen.getByRole('navigation', { name: '업무 도구' })).toHaveAttribute('data-layout', 'bottom')
  fireEvent.click(entry)
  expect(screen.getByRole('dialog', { name: '대화 보조 패널' })).toHaveClass('max-h-[70%]')
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(entry).toHaveFocus()
})

it('레일·펼친 탭은 키보드로 전환하고 이력 데이터와 포커스를 보인다', async () => {
  stub()
  renderWithProviders(view(task))
  const entry = screen.getByRole('button', { name: '이력' })
  entry.focus()
  await userEvent.keyboard(' ')
  expect(await screen.findByText('사유: 추가 확인')).toBeVisible()
  const tab = screen.getByRole('tab', { name: '이력' })
  tab.focus()
  await userEvent.keyboard('{Home}')
  expect(screen.getByRole('tab', { name: '자료' })).toHaveFocus()
  expect(screen.getByRole('tab', { name: '자료' })).toHaveAttribute('aria-selected', 'true')
})

it.each(['fetch', 'stream'] as const)('AI 응답 대기 중 키보드 탭 전환이 Composer와 입력·전송 상태를 유지한다 (%s)', async (waitingFor) => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync })
  const pendingResponse = new Promise<Response>(() => {})
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/threads/h-pending/requests') {
      if (waitingFor === 'fetch') return pendingResponse
      // started만 전달하고 스트림을 닫지 않아 AI 응답 완료를 계속 기다린다.
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode('event: started\ndata: {"requestId":"r-pending","replyMessageId":"reply-pending","userMessageId":"user-pending"}\n\n'))
      } }), { status: 201, headers: { 'content-type': 'text/event-stream' } })
    }
    if (url === '/api/threads/h-pending/requests/estimate') return jsonResponse(200, {
      at: task.createdAt, provider: 'mock', transport: 'inline', model: 'mock', bytes: 100, limitBytes: 10_000,
      inputs: [], srCodes: [], srs: [], overLimit: false, attachmentLimit: 20,
    })
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    if (url === '/api/settings') return jsonResponse(200, { fileMaxPerRequest: 20 })
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [] })
    return jsonResponse(200, [])
  })
  vi.stubGlobal('fetch', fetchMock)
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><TaskHeader task={task} assistant={assistant} /><TaskBody task={{ ...task, threadId: 'h-pending' }} assistant={{ id: 'a', name: '도우미' } as Assistant} /></TooltipProvider></MeContext>)
  const chat = () => within(screen.getByRole('region', { name: '대화' }))
  const input = chat().getByRole('textbox')
  const send = chat().getByRole('button', { name: '전송' })
  const composer = input.parentElement!.parentElement!
  const draft = '응답을 기다리는 AI 요청'
  // 초기 메시지 조회도 추정 revision을 바꾸므로 완료 후 초안의 디바운스를 진행한다.
  await chat().findByText('[+ 첨부]에서 이번 질문에 보낼 파일·대화를 고를 수 있어요.')
  fireEvent.change(input, { target: { value: draft } })
  expect(send).toBeDisabled()
  await act(() => vi.advanceTimersByTimeAsync(400))
  await waitFor(() => expect(send).toBeEnabled())
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/threads/h-pending/requests', expect.objectContaining({ method: 'POST' })))

  let expectedDraft = ''
  function expectComposerPreserved() {
    const currentInput = chat().getByRole('textbox', { hidden: true })
    expect(currentInput.parentElement!.parentElement!).toBe(composer)
    expect(currentInput).toBe(input)
    expect(currentInput).toHaveValue(expectedDraft)
    expect(chat().getByRole('timer', { hidden: true })).toBeInTheDocument()
    if (waitingFor === 'fetch') {
      expect(currentInput).toBeDisabled()
      expect(chat().getByRole('button', { name: '전송', hidden: true })).toBeDisabled()
      expect(chat().queryByRole('button', { name: '중지', hidden: true })).not.toBeInTheDocument()
    } else {
      expect(currentInput).toBeEnabled()
      expect(chat().getByRole('button', { name: '중지', hidden: true })).toBeEnabled()
      expect(chat().queryByRole('button', { name: '전송', hidden: true })).not.toBeInTheDocument()
    }
  }
  await waitFor(expectComposerPreserved)
  expect(screen.queryByRole('button', { name: '전송 기록' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '파일 빼고 다시' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '텍스트로 보내기' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '더 보기' }))
  for (const label of ['전송 기록', '파일 빼고 다시', '텍스트로 보내기']) expect(screen.queryByRole('menuitem', { name: label })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  if (waitingFor === 'stream') {
    expectedDraft = '응답 중 작성한 다음 질문'
    fireEvent.change(input, { target: { value: expectedDraft } })
  }

  for (let i = 0; i < 2; i++) {
    fireEvent.click(screen.getByRole('button', { name: '메모' }))
    expectComposerPreserved()
    fireEvent.click(screen.getByRole('tab', { name: '체크' }))
    expectComposerPreserved()
    fireEvent.click(screen.getByRole('button', { name: '접기' }))
    expectComposerPreserved()
  }
})

it.each(['done', 'error'] as const)('헤더 메뉴에서 기존 기록·파일 재시도 대화상자를 열고 오류 때만 임시 노출한다 (%s)', async status => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    if (url.endsWith('/candidates')) return jsonResponse(200, { files: [], conversations: [] })
    if (url === '/api/threads/h/messages') return jsonResponse(200, [{ id: 'm', threadId: 'h', seq: 1, role: 'assistant', content: '답변', status, requestId: 'r', attachmentIds: [], createdAt: task.createdAt }])
    if (url === '/api/requests/r') return jsonResponse(200, { id: 'r', threadId: 'h', status: status === 'done' ? 'succeeded' : 'failed', model: 'mock', bytes: 3, limitBytes: 100, hasSnapshot: true, inputs: [{ kind: 'file', fileId: 'f', sourceLabel: '근거.txt', weight: 'reference', bytes: 3 }] })
    return jsonResponse(200, [])
  }))
  renderWithProviders(view(task))
  await waitFor(() => expect(useTaskChatActions.getState().byTask.t?.info).toBeTypeOf('function'))
  expect(screen.queryByRole('button', { name: '전송 기록' }) !== null).toBe(status === 'error')
  const user = userEvent.setup()
  if (status === 'done') {
    await user.click(screen.getByRole('button', { name: '더 보기' }))
    expect(screen.queryByRole('menuitem', { name: '전송 기록' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '파일 빼고 다시' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '텍스트로 보내기' })).not.toBeInTheDocument()
    return
  }
  for (const [label, title] of [['전송 기록', '사용한 자료'], ['파일 빼고 다시', '다시 보낼 때 뺄 파일'], ['텍스트로 보내기', '본문으로 보낼 텍스트 파일']] as const) {
    await user.click(screen.getByRole('button', { name: '더 보기' }))
    await user.click(screen.getByRole('menuitem', { name: label }))
    expect(await screen.findByRole('dialog', { name: title })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  }
})

it('초안 크기 정상→한도 초과→정상 전환에서만 헤더·메뉴 오류 도구를 노출한다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/requests/estimate')) {
      const over = JSON.parse(String(init?.body)).draft === '초과'
      return jsonResponse(200, { at: task.createdAt, provider: 'mock', transport: 'inline', model: 'mock', bytes: over ? 200 : 10, limitBytes: 100,
        inputs: [], srCodes: [], srs: [], overLimit: over, attachmentLimit: 20 })
    }
    if (url.endsWith('/candidates')) return jsonResponse(200, { files: [], conversations: [] })
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    return jsonResponse(200, [])
  }))
  renderWithProviders(view(task))
  const input = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  const send = screen.getByRole('button', { name: '전송' })
  await screen.findByText('[+ 첨부]에서 이번 질문에 보낼 파일·대화를 고를 수 있어요.')
  fireEvent.change(input, { target: { value: '정상' } })
  await act(() => vi.advanceTimersByTimeAsync(400))
  await waitFor(() => expect(send).toBeEnabled())
  expect(screen.queryByRole('button', { name: '전송 기록' })).not.toBeInTheDocument()
  fireEvent.change(input, { target: { value: '초과' } })
  await act(() => vi.advanceTimersByTimeAsync(400))
  expect(await screen.findByRole('button', { name: '전송 기록' })).toBeInTheDocument()
  expect(send).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '더 보기' }))
  expect(screen.getByRole('menuitem', { name: '파일 빼고 다시' })).toBeInTheDocument()
  await user.keyboard('{Escape}')
  fireEvent.change(input, { target: { value: '정상' } })
  await act(() => vi.advanceTimersByTimeAsync(400))
  await waitFor(() => expect(screen.queryByRole('button', { name: '전송 기록' })).not.toBeInTheDocument())
  await waitFor(() => expect(send).toBeEnabled())
})


it('MDI 숨김 중 발생한 0 스크롤 이벤트는 저장된 위치를 지우지 않고 복귀 때 복원한다', async () => {
  stub()
  useMaterialsDrawer.getState().choose('t', 'open', 'notes')
  useMaterialsDrawer.getState().update('t', { scroll: { notes: 137 } })
  let show!: (active: boolean) => void
  function Harness() {
    const [active, setActive] = useState(false)
    show = setActive
    return <TabActiveContext value={active}>{view(task)}</TabActiveContext>
  }
  renderWithProviders(<Harness />)
  const panel = screen.getByRole('tabpanel', { name: '메모' })
  fireEvent.scroll(panel, { target: { scrollTop: 0 } })
  expect(useMaterialsDrawer.getState().byTask.t?.scroll.notes).toBe(137)
  act(() => show(true))
  expect(panel.scrollTop).toBe(137)
})

it('복원 중 콘텐츠가 짧아서 잘린 중간 스크롤은 저장하지 않고 로딩 후 원래 위치로 복원한다', () => {
  stub()
  useMaterialsDrawer.getState().choose('t', 'open', 'materials')
  useMaterialsDrawer.getState().update('t', { scroll: { materials: 500 } })
  let maxScroll = 100
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!
  const setter = vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function(this: Element, value: number) {
    descriptor.set!.call(this, this.getAttribute('role') === 'tabpanel' ? Math.min(value, maxScroll) : value)
  })
  let resized = () => {}
  const originalResize = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    constructor(private callback: () => void) {}
    observe(node: Element) { if (node.parentElement?.getAttribute('role') === 'tabpanel') resized = this.callback }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  const rendered = renderWithProviders(view(task))
  try {
    const panel = screen.getByRole('tabpanel', { name: '자료' })
    expect(panel.scrollTop).toBe(100)
    fireEvent.scroll(panel)
    expect(useMaterialsDrawer.getState().byTask.t?.scroll.materials).toBe(500)
    maxScroll = 1000
    act(() => resized())
    expect(panel.scrollTop).toBe(500)
  } finally { rendered.unmount(); setter.mockRestore(); globalThis.ResizeObserver = originalResize }
})
