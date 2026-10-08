import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { AgentTestChat } from './AgentTestChat'

const NOTICE = '업무 맥락 없이 모델에 직접 보냅니다. 상위 서비스가 자체 기록할 수 있습니다.'
afterEach(() => vi.unstubAllGlobals())
function type(text: string) { fireEvent.change(screen.getByRole('textbox', { name: '시험 메시지' }), { target: { value: text } }) }
const send = () => fireEvent.click(screen.getByRole('button', { name: '전송' }))

describe('AgentTestChat', () => {
  it('미니 바는 모델과 기본 모델 여부만 보여주고 안내문을 띄운다', () => {
    vi.stubGlobal('fetch', vi.fn())
    const { unmount } = renderWithProviders(<AgentTestChat modelId="fake-writer" />)
    expect(screen.getByText('fake-writer')).toBeInTheDocument()
    expect(screen.queryByText('기본 모델')).not.toBeInTheDocument()
    expect(screen.getByText(NOTICE)).toBeInTheDocument()
    unmount()
    renderWithProviders(<AgentTestChat />)
    expect(screen.getByText('기본 모델')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('전송하면 이력을 모두 담아 시험 API를 부르고 답을 모델·소요 시간과 함께 보여준다', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: unknown[] }
      return jsonResponse(200, { text: `답 ${body.messages.length}`, model: 'fake-general', ms: 42 })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AgentTestChat modelId="fake-general" />)
    type('첫 질문')
    send()
    const transcript = screen.getByRole('list', { name: '시험 대화 이력' })
    expect(await within(transcript).findByText('답 1')).toBeInTheDocument()
    expect(screen.getByText('fake-general · 42 ms')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '시험 메시지' })).toHaveValue('')
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/llm/test', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }))
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ model: 'fake-general', messages: [{ role: 'user', content: '첫 질문' }] })
    type('둘째')
    send()
    expect(await within(transcript).findByText('답 3')).toBeInTheDocument()
    expect(JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({ model: 'fake-general',
      messages: [{ role: 'user', content: '첫 질문' }, { role: 'assistant', content: '답 1' }, { role: 'user', content: '둘째' }] })
    fireEvent.click(screen.getByRole('button', { name: '초기화' }))
    expect(within(transcript).queryByText('답 1')).not.toBeInTheDocument()
  })

  it('기본 모델이면 model을 보내지 않는다', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { text: '답', model: 'glm', ms: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AgentTestChat />)
    type('질문')
    send()
    await screen.findByText('답')
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ messages: [{ role: 'user', content: '질문' }] })
  })

  it('중지하면 호출을 끊고 보낸 메시지를 입력란으로 되돌린다', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    renderWithProviders(<AgentTestChat modelId="m" />)
    type('취소될 질문')
    send()
    expect(await screen.findByRole('button', { name: '중지' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '시험 메시지' })).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: '중지' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '시험 메시지' })).toHaveValue('취소될 질문'))
    expect(screen.getByRole('status')).toHaveTextContent('중지했습니다. 입력은 그대로 두었습니다.')
    expect(within(screen.getByRole('list', { name: '시험 대화 이력' })).queryByText('취소될 질문')).not.toBeInTheDocument()
  })

  it.each([
    [413, undefined, '요청이 크기 한도를 넘었습니다.'],
    [429, undefined, '동시 요청이 많습니다. 잠시 후 다시 시도하세요.'],
    [504, 'TIMEOUT', '응답 시간을 초과했습니다.'],
    [502, 'MODEL_NOT_FOUND', '모델을 찾을 수 없습니다. 모델 ID를 확인하세요.'],
    [502, 'RESPONSE_TOO_LARGE', '응답이 크기 한도를 넘었습니다.'],
    [502, 'PROVIDER_ERROR', 'AI 서비스에 연결하지 못했습니다.'],
    [403, undefined, 'System Owner만 시험할 수 있습니다.'],
    [400, undefined, '요청 형식이나 길이가 맞지 않습니다. 메시지를 줄이거나 초기화하세요.'],
  ])('실패 %s %s는 분류된 안내와 연결 진단 링크를 보여주고 입력을 되돌린다', async (status, code, text) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status, { message: '서버 문구', ...(code ? { code } : {}) })))
    renderWithProviders(<AgentTestChat modelId="m" />)
    type('질문')
    send()
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.getByRole('link', { name: '연결 진단 열기' })).toHaveAttribute('href', '/admin/diagnostics')
    expect(screen.getByRole('textbox', { name: '시험 메시지' })).toHaveValue('질문')
  })

  it('네트워크 오류도 연결 실패로 분류하고 진단 링크는 숨길 수 있다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    renderWithProviders(<AgentTestChat modelId="m" showDiagnosticsLink={false} />)
    type('질문')
    send()
    expect(await screen.findByRole('alert')).toHaveTextContent('AI 서비스에 연결하지 못했습니다.')
    expect(screen.queryByRole('link', { name: '연결 진단 열기' })).not.toBeInTheDocument()
  })

  it('화면을 떠나면 진행 중인 시험 호출을 끊는다', async () => {
    let seen: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => { seen = init.signal ?? undefined; return new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }) }))
    const { unmount } = renderWithProviders(<AgentTestChat modelId="m" />)
    type('질문')
    send()
    await waitFor(() => expect(seen).toBeDefined())
    unmount()
    expect(seen?.aborted).toBe(true)
  })

  it('메시지 20개에 닿으면 전송을 막고 초기화를 안내한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { text: '답', model: 'm', ms: 1 })))
    renderWithProviders(<AgentTestChat modelId="m" />)
    for (let turn = 0; turn < 10; turn++) {
      type(`질문 ${turn}`)
      send()
      await waitFor(() => expect(screen.getAllByText('답')).toHaveLength(turn + 1))
    }
    expect(screen.getByText('시험 대화는 메시지 20개까지입니다. 초기화 후 계속하세요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '전송' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '초기화' }))
    expect(screen.queryByText('답')).not.toBeInTheDocument()
  })
})
