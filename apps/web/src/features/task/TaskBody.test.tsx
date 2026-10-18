import { useState } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
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
import { useMaterialsDrawer } from './materialsDrawer'
import { useTagShareStore } from './tagShare'

const task = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '대화', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: [], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' } satisfies Task

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); useMaterialsDrawer.setState({ byTask: {} }); useTagShareStore.setState({ openSeq: {}, consumedSeq: {} }) })

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

it('맥락 없는 대화는 닫히고 자료 열기는 패널에 초점을 주며 입력·선택을 보존한다', async () => {
  stub()
  renderWithProviders(view(task))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  const toggle = screen.getByRole('button', { name: /^연결 자료/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const input = screen.getByRole('textbox', { name: 'AI 요청 입력' })
  fireEvent.change(input, { target: { value: '유지할 입력' } })
  await userEvent.click(await screen.findByRole('button', { name: '자료 열기' }))
  const panel = screen.getByRole('complementary', { name: '#태그·SR 연결 자료' })
  await waitFor(() => expect(panel).toHaveFocus())
  expect(toggle).toHaveAttribute('aria-controls', panel.id)
  expect(screen.getByRole('textbox', { name: 'AI 요청 입력' })).toBe(input)
  expect(input).toHaveValue('유지할 입력')
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalledWith(expect.stringMatching(/inputs/), expect.objectContaining({ method: 'PUT' }))
})

it.each([{ tags: ['A'] }, { linkedSrCodes: ['SR-2026-0001'] }])('태그/SR 자동 열림, 수동 닫힘 유지, 새 태그 추가만 다시 연다: %j', async context => {
  stub()
  let update: (value: Task) => void = () => {}
  function Harness() { const [value, setValue] = useState<Task>({ ...task, ...context }); update = setValue; return view(value) }
  renderWithProviders(<Harness />)
  const toggle = screen.getByRole('button', { name: /^연결 자료/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await userEvent.click(toggle)
  expect(sessionStorage.getItem('mes-hub:panel-state:t')).toBe('closed')
  act(() => update({ ...task, ...context, title: '갱신' }))
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  act(() => update({ ...task, ...context, tags: [...(context.tags ?? []), 'B'] }))
  await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'))
})

it('대화별 수동 선택은 재마운트/MDI 전환에도 유지되고 보조 도구는 메뉴와 키보드로 열린다', async () => {
  stub()
  sessionStorage.setItem('mes-hub:panel-state:t', 'closed')
  const { unmount } = renderWithProviders(view({ ...task, tags: ['A'] }))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '더 보기' }))
  await user.click(screen.getByRole('menuitem', { name: '활동 이력 열기' }))
  expect(await screen.findByText('사유: 추가 확인')).toBeInTheDocument()
  expect(screen.getByText('보조 도구').closest('details')).toHaveAttribute('open')
  unmount()
  renderWithProviders(view(task))
  expect(screen.getByRole('complementary')).toBeInTheDocument()
  expect(screen.getByText('보조 도구').closest('details')).not.toHaveAttribute('open')
})

it('MDI 두 대화의 패널 id와 수동 선택은 겹치지 않는다', async () => {
  stub()
  renderWithProviders(<>{view({ ...task, tags: ['A'] })}{view({ ...task, id: 't2', threadId: 'h2', tags: ['A'] })}</>)
  const panels = screen.getAllByRole('complementary')
  expect(new Set(panels.map(panel => panel.id)).size).toBe(2)
  const toggles = screen.getAllByRole('button', { name: '연결 자료(0)' })
  fireEvent.click(toggles[0]!)
  expect(toggles[0]).toHaveAttribute('aria-expanded', 'false')
  expect(toggles[1]).toHaveAttribute('aria-expanded', 'true')
})

it.each(['fetch', 'stream'] as const)('AI 응답 대기 중 키보드 탭 전환이 Composer와 입력·전송 상태를 유지한다 (%s)', async (waitingFor) => {
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
  const composer = input.parentElement!.parentElement!
  const draft = '응답을 기다리는 AI 요청'
  fireEvent.change(input, { target: { value: draft } })
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
  await userEvent.click(screen.getByRole('button', { name: '더 보기' }))
  for (const label of ['전송 기록', '파일 빼고 다시', '텍스트로 보내기']) expect(screen.queryByRole('menuitem', { name: label })).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  if (waitingFor === 'stream') {
    expectedDraft = '응답 중 작성한 다음 질문'
    fireEvent.change(input, { target: { value: expectedDraft } })
  }

  // 패널·보조 도구를 열고 닫는 동안에도 입력·전송 상태는 같은 인스턴스다.
  for (let i = 0; i < 2; i++) {
    fireEvent.click(screen.getByRole('button', { name: /^연결 자료/ }))
    fireEvent.click(screen.getByText('보조 도구'))
    expectComposerPreserved()
    fireEvent.click(screen.getByText('보조 도구'))
    expectComposerPreserved()
    fireEvent.click(screen.getByRole('button', { name: /^연결 자료/ }))
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

it('자동 상태에서 마지막 태그가 빠지면 패널이 닫힌다', async () => {
  stub()
  let update: (value: Task) => void = () => {}
  function Harness() { const [value, setValue] = useState<Task>({ ...task, tags: ['A'] }); update = setValue; return view(value) }
  renderWithProviders(<Harness />)
  expect(screen.getByRole('complementary')).toBeInTheDocument()
  act(() => update(task))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

it('더 보기 방향키·Space로 메모를 열고 해당 보조 영역에 초점을 옮긴다', async () => {
  stub()
  renderWithProviders(view(task))
  const user = userEvent.setup()
  screen.getByRole('button', { name: '더 보기' }).focus()
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: '체크리스트 열기' })).toHaveFocus()
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: '메모 열기' })).toHaveFocus()
  await user.keyboard(' ')
  await waitFor(() => expect(screen.getByRole('region', { name: '메모' })).toHaveFocus())
  expect(screen.getByText('보조 도구').closest('details')).toHaveAttribute('open')
})


it('태그 추가→제거는 자동 규칙을 따르고, 수동 닫힘 뒤 맥락 추가도 override를 지운다', async () => {
  stub()
  let update!: (value: Task) => void
  function Harness() { const [value, setValue] = useState<Task>(task); update = setValue; return view(value) }
  renderWithProviders(<Harness />)
  act(() => update({ ...task, tags: ['A'] }))
  expect(screen.getByRole('complementary')).toBeInTheDocument()
  expect(sessionStorage.getItem('mes-hub:panel-state:t')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^연결 자료/ }))
  act(() => update({ ...task, tags: ['A', 'B'] }))
  await waitFor(() => expect(screen.getByRole('complementary')).toBeInTheDocument())
  expect(sessionStorage.getItem('mes-hub:panel-state:t')).toBeNull()
  act(() => update(task))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

it('공유 안내로 연 뒤 수동 닫힘은 LRU에 해당하는 언마운트→복귀에도 유지하고 새 안내는 처리한다', async () => {
  stub()
  const first = renderWithProviders(view(task))
  act(() => useTagShareStore.getState().openMaterials('t'))
  await waitFor(() => expect(screen.getByRole('complementary')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /^연결 자료/ }))
  first.unmount()
  renderWithProviders(view(task))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  act(() => useTagShareStore.getState().openMaterials('t'))
  await waitFor(() => expect(screen.getByRole('complementary')).toBeInTheDocument())
})

it('패널 접기→펼치기는 메모 본문·첨부와 진행 중 체크리스트 검토를 보존한다', async () => {
  let signal!: AbortSignal
  let stream!: ReadableStreamDefaultController<Uint8Array>
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/checklist/review')) {
      signal = init!.signal!
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }))
    }
    if (url.endsWith('/files')) return jsonResponse(200, [{ id: 'f', name: '메모.txt', version: 1 }])
    if (url.endsWith('/candidates')) return jsonResponse(200, { files: [], conversations: [] })
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    return jsonResponse(200, [])
  }))
  renderWithProviders(view({ ...task, tags: ['A'], checklist: [{ id: 'c', label: '근거', required: false, checked: false }] }))
  fireEvent.click(screen.getByText('보조 도구'))
  const memo = screen.getByRole('textbox', { name: '메모 본문' })
  fireEvent.change(memo, { target: { value: '보존할 메모' } })
  const attachment = await screen.findByRole('checkbox', { name: '메모.txt v1' })
  fireEvent.click(attachment)
  fireEvent.click(screen.getByRole('button', { name: 'AI 달성도 점검' }))
  await waitFor(() => expect(stream).toBeDefined())
  await act(async () => stream.enqueue(new TextEncoder().encode('event: item\ndata: {"itemId":"c","met":true,"note":"진행 중 판단"}\n\n')))
  const toggle = screen.getByRole('button', { name: /^연결 자료/ })
  fireEvent.click(toggle)
  expect(signal.aborted).toBe(false)
  fireEvent.click(toggle)
  expect(screen.getByRole('textbox', { name: '메모 본문' })).toBe(memo)
  expect(memo).toHaveValue('보존할 메모')
  expect(screen.getByRole('checkbox', { name: '메모.txt v1' })).toBeChecked()
  expect(screen.getByText('진행 중 판단')).toBeVisible()
  expect(screen.getByRole('button', { name: 'AI 달성도 점검' })).toBeDisabled()
})

it('좁은 화면 자동 열림은 접힌 바이며 펼친 다음에만 50% 자료 영역을 쓴다', async () => {
  stub()
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addListener() {}, removeListener() {} }))
  renderWithProviders(view({ ...task, tags: ['A'] }))
  const toggle = screen.getByRole('button', { name: /^연결 자료/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const bar = screen.getByRole('complementary').querySelector('summary')!
  expect(bar.closest('details')).not.toHaveAttribute('open')
  fireEvent.click(bar)
  await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'))
  expect(bar.closest('details')).toHaveAttribute('open')
  expect(screen.getByRole('complementary')).toHaveClass('max-lg:max-h-[50%]')
})

it('초안 크기 정상→한도 초과→정상 전환에서만 헤더·메뉴 오류 도구를 노출한다', async () => {
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
  fireEvent.change(input, { target: { value: '정상' } })
  await waitFor(() => expect(screen.getByRole('button', { name: '전송' })).toBeEnabled())
  expect(screen.queryByRole('button', { name: '전송 기록' })).not.toBeInTheDocument()
  fireEvent.change(input, { target: { value: '초과' } })
  expect(await screen.findByRole('button', { name: '전송 기록' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '전송' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: '더 보기' }))
  expect(screen.getByRole('menuitem', { name: '파일 빼고 다시' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  fireEvent.change(input, { target: { value: '정상' } })
  await waitFor(() => expect(screen.queryByRole('button', { name: '전송 기록' })).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole('button', { name: '전송' })).toBeEnabled())
})

it('같은 화면 인스턴스에서 대화 ID가 바뀌면 이전 대화의 메모 초안·첨부를 섞지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/files')) return jsonResponse(200, [{ id: 'f', name: '공통.txt', version: 1 }])
    if (url.endsWith('/candidates')) return jsonResponse(200, { files: [], conversations: [] })
    if (url === '/api/llm/models') return jsonResponse(200, { models: [] })
    return jsonResponse(200, [])
  }))
  let update!: (value: Task) => void
  function Harness() { const [value, setValue] = useState<Task>({ ...task, tags: ['A'] }); update = setValue; return view(value) }
  renderWithProviders(<Harness />)
  fireEvent.click(screen.getByText('보조 도구'))
  fireEvent.change(screen.getByRole('textbox', { name: '메모 본문' }), { target: { value: '첫 대화 메모' } })
  fireEvent.click(await screen.findByRole('checkbox', { name: '공통.txt v1' }))
  act(() => update({ ...task, id: 'second', threadId: 'second-thread', tags: ['A'] }))
  if (!screen.getByText('보조 도구').closest('details')!.open) fireEvent.click(screen.getByText('보조 도구'))
  expect(screen.getByRole('textbox', { name: '메모 본문' })).toHaveValue('')
  expect(await screen.findByRole('checkbox', { name: '공통.txt v1' })).not.toBeChecked()
})
