import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { SrDetail } from '@/api/sr'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { SrConvertSheet } from './SrConvertSheet'

// 초안: 접수 첨부(정본)는 아직 없고, 이 SR에 올라간 파일 전체가 후보다.
const draft: SrDetail = { id: 'sr', code: '', requesterId: 'u', title: '', titleSource: 'default', body: '', status: 'draft', attachmentIds: [], candidateAttachmentIds: ['f1', 'f2'],
  threadId: 'thread', results: [], conversations: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }
const files: Record<string, unknown> = { f1: { id: 'f1', name: '알람.txt', version: 1, size: 10, source: 'upload' }, f2: { id: 'f2', name: '화면.png', version: 1, size: 10, source: 'upload' } }
afterEach(() => vi.unstubAllGlobals())

function mount(sr: SrDetail, fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => url === '/api/service-requests/sr' && init?.method === 'GET' ? Promise.resolve(jsonResponse(200, sr)) : fetchImpl(url, init)))
  const onSaved = vi.fn()
  renderWithProviders(<TooltipProvider><SrConvertSheet sr={sr} open onOpenChange={() => undefined} onSaved={onSaved} /></TooltipProvider>)
  return onSaved
}

it('초안 로딩 중 표시 후 AI 초안을 채우고, 사람이 먼저 고친 칸은 늦게 온 초안이 덮어쓰지 않는다', async () => {
  let release!: (value: Response) => void
  mount(draft, async (url) => {
    if (url === '/api/service-requests/sr/draft') return new Promise<Response>((resolve) => { release = resolve })
    if (url.startsWith('/api/files/')) return jsonResponse(200, files[url.split('/')[3]!])
    return jsonResponse(200, [])
  })
  const sheet = await screen.findByRole('dialog')
  expect(within(sheet).getByRole('status')).toHaveTextContent('AI가 초안을 만드는 중')
  await userEvent.type(within(sheet).getByRole('textbox', { name: 'SR 제목' }), '내가 쓴 제목')
  expect(within(sheet).getByText('직접 입력')).toBeInTheDocument()
  release(jsonResponse(200, { title: 'AI 제목', body: '## 요청 내용\n- 알람' }))
  await waitFor(() => expect(within(sheet).getByRole('textbox', { name: 'SR 본문' })).toHaveValue('## 요청 내용\n- 알람'))
  expect(within(sheet).getByRole('textbox', { name: 'SR 제목' })).toHaveValue('내가 쓴 제목')
  expect(within(sheet).queryByRole('status')).not.toBeInTheDocument()
})

it('첨부는 기본 전부 선택이고 해제한 파일은 접수에서 빠지며, 미리보기 탭은 Markdown을 그린다', async () => {
  const bodies: unknown[] = []
  mount(draft, async (url, init) => {
    if (url === '/api/service-requests/sr/draft') return jsonResponse(200, { title: 'AI 제목', body: '**굵게** 본문' })
    if (url.startsWith('/api/files/')) return jsonResponse(200, files[url.split('/')[3]!])
    if (url === '/api/service-requests/sr/submit') { bodies.push(JSON.parse(String(init?.body))); return jsonResponse(201, { ...draft, code: 'SR-2026-0001', status: 'submitted' }) }
    return jsonResponse(200, [])
  })
  const sheet = await screen.findByRole('dialog')
  await waitFor(() => expect(within(sheet).getByRole('textbox', { name: 'SR 제목' })).toHaveValue('AI 제목'))
  expect(within(sheet).getByText('AI 제안')).toBeInTheDocument()
  const first = await within(sheet).findByRole('checkbox', { name: '알람.txt' })
  const second = within(sheet).getByRole('checkbox', { name: '화면.png' })
  expect(first).toBeChecked(); expect(second).toBeChecked()
  await userEvent.click(second)
  expect(second).not.toBeChecked()
  await userEvent.click(within(sheet).getByRole('tab', { name: '미리보기' }))
  expect(await within(sheet).findByText('굵게', { selector: 'strong' })).toBeInTheDocument()
  await userEvent.click(within(sheet).getByRole('button', { name: '접수 제출' }))
  await waitFor(() => expect(bodies).toEqual([{ title: 'AI 제목', titleSource: 'ai', body: '**굵게** 본문', attachmentIds: ['f1'], updatedAt: draft.updatedAt }]))
})

it('AI로 다듬기는 제안만 보여 주고, 사람이 적용을 눌러야 제목·본문에 반영된다', async () => {
  const refines: unknown[] = []
  mount(draft, async (url, init) => {
    if (url === '/api/service-requests/sr/draft') return jsonResponse(200, { title: '원래 제목', body: '원래 본문' })
    if (url === '/api/service-requests/sr/refine') { refines.push(JSON.parse(String(init?.body))); return jsonResponse(201, { title: '다듬은 제목', body: '다듬은 본문' }) }
    if (url.startsWith('/api/files/')) return jsonResponse(200, files[url.split('/')[3]!])
    return jsonResponse(200, [])
  })
  const sheet = await screen.findByRole('dialog')
  await waitFor(() => expect(within(sheet).getByRole('textbox', { name: 'SR 제목' })).toHaveValue('원래 제목'))
  await userEvent.click(within(sheet).getByRole('button', { name: 'AI로 다듬기' }))
  await waitFor(() => expect(refines).toEqual([{ title: '원래 제목', body: '원래 본문' }]))
  const proposal = await within(sheet).findByRole('region', { name: 'AI 제안 (적용 전)' })
  expect(proposal).toHaveTextContent('다듬은 제목')
  expect(proposal).toHaveTextContent('다듬은 본문')
  expect(within(sheet).getByRole('textbox', { name: 'SR 제목' })).toHaveValue('원래 제목')
  expect(within(sheet).getByRole('textbox', { name: 'SR 본문' })).toHaveValue('원래 본문')
  await userEvent.click(within(proposal).getByRole('button', { name: '제안 적용' }))
  expect(within(sheet).getByRole('textbox', { name: 'SR 제목' })).toHaveValue('다듬은 제목')
  expect(within(sheet).getByRole('textbox', { name: 'SR 본문' })).toHaveValue('다듬은 본문')
  expect(within(sheet).queryByRole('region', { name: 'AI 제안 (적용 전)' })).not.toBeInTheDocument()
})

it('접수 내용 수정은 후보 전체를 나열하되 저장된 선택만 체크하고, 다시 선택한 파일을 저장에 보낸다', async () => {
  const bodies: unknown[] = []
  mount({ ...draft, code: 'SR-2026-0001', title: '접수 제목', titleSource: 'manual', body: '접수 본문', status: 'submitted', attachmentIds: ['f1'] }, async (url, init) => {
    if (url.startsWith('/api/files/')) return jsonResponse(200, files[url.split('/')[3]!])
    if (url === '/api/service-requests/sr/content') { bodies.push(JSON.parse(String(init?.body))); return jsonResponse(200, { ...draft, status: 'submitted' }) }
    return jsonResponse(200, [])
  })
  const sheet = await screen.findByRole('dialog')
  expect(within(sheet).getByRole('heading', { name: '접수 내용 수정' })).toBeInTheDocument()
  const first = await within(sheet).findByRole('checkbox', { name: '알람.txt' })
  const second = within(sheet).getByRole('checkbox', { name: '화면.png' })
  expect(first).toBeChecked(); expect(second).not.toBeChecked()
  await userEvent.click(second)
  expect(second).toBeChecked()
  await userEvent.click(within(sheet).getByRole('button', { name: '저장' }))
  await waitFor(() => expect(bodies).toEqual([{ title: '접수 제목', titleSource: 'manual', body: '접수 본문', attachmentIds: ['f1', 'f2'], updatedAt: draft.updatedAt }]))
  expect(fetch).not.toHaveBeenCalledWith('/api/service-requests/sr/draft', expect.anything())
})

it('옛 reviewing 행은 접수됨과 같이 수정 모드로 연다', async () => {
  mount({ ...draft, code: 'SR-2026-0001', title: '접수 제목', titleSource: 'manual', body: '접수 본문', status: 'reviewing', attachmentIds: ['f1'] }, async (url) => {
    if (url.startsWith('/api/files/')) return jsonResponse(200, files[url.split('/')[3]!])
    return jsonResponse(200, [])
  })
  const sheet = await screen.findByRole('dialog')
  expect(within(sheet).getByRole('heading', { name: '접수 내용 수정' })).toBeInTheDocument()
  expect(sheet).toHaveTextContent('처리 시작 전까지 내용을 수정할 수 있습니다.')
  expect(within(sheet).getByRole('textbox', { name: 'SR 제목' })).not.toHaveAttribute('readonly')
  expect(within(sheet).getByRole('button', { name: '저장' })).toBeInTheDocument()
})

it('처리가 시작된 접수 내용은 읽기 전용으로 보여 주고 제출·다듬기 버튼이 없다', async () => {
  mount({ ...draft, code: 'SR-2026-0001', title: '접수 제목', titleSource: 'manual', body: '접수 본문', status: 'in_progress', attachmentIds: ['f1'] }, async (url) => {
    if (url.startsWith('/api/files/')) return jsonResponse(200, files[url.split('/')[3]!])
    return jsonResponse(200, [])
  })
  const sheet = await screen.findByRole('dialog')
  expect(within(sheet).getByRole('heading', { name: '접수 내용 보기' })).toBeInTheDocument()
  expect(within(sheet).getByRole('textbox', { name: 'SR 제목' })).toHaveValue('접수 제목')
  expect(within(sheet).getByRole('textbox', { name: 'SR 제목' })).toHaveAttribute('readonly')
  const first = await within(sheet).findByRole('checkbox', { name: '알람.txt' })
  expect(first).toBeDisabled(); expect(first).toBeChecked()
  const second = within(sheet).getByRole('checkbox', { name: '화면.png' })
  expect(second).toBeDisabled(); expect(second).not.toBeChecked()
  expect(within(sheet).queryByRole('button', { name: '접수 제출' })).not.toBeInTheDocument()
  expect(within(sheet).queryByRole('button', { name: '저장' })).not.toBeInTheDocument()
  expect(within(sheet).queryByRole('button', { name: 'AI로 다듬기' })).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalledWith('/api/service-requests/sr/draft', expect.anything())
})


it('dirty sheet survives list refresh and warns before saving a stale updatedAt', async () => {
  const sr: SrDetail = { ...draft, title: '접수 제목', body: '원본 본문', status: 'submitted', attachmentIds: ['f1'] }
  const writes = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/files/')) return jsonResponse(200, files[url.split('/')[3]!])
    if (init?.method === 'PATCH') writes()
    return jsonResponse(200, { ...sr, updatedAt: '2026-10-02' })
  }))
  const onSaved = vi.fn()
  const view = (value: SrDetail) => <TooltipProvider><SrConvertSheet sr={value} open onOpenChange={() => undefined} onSaved={onSaved} /></TooltipProvider>
  let refresh!: (value: SrDetail) => void
  function Harness() { const [value, setValue] = useState(sr); refresh = setValue; return view(value) }
  renderWithProviders(<Harness />)
  const sheet = await screen.findByRole('dialog')
  await userEvent.type(within(sheet).getByRole('textbox', { name: 'SR 제목' }), ' 내 수정')
  await userEvent.type(within(sheet).getByRole('textbox', { name: 'SR 본문' }), ' 내 본문')
  await userEvent.click(await within(sheet).findByRole('checkbox', { name: '화면.png' }))
  act(() => refresh({ ...sr, title: '외부 변경', body: '외부 본문', attachmentIds: [], candidateAttachmentIds: [...sr.candidateAttachmentIds], updatedAt: '2026-10-02' }))
  expect(within(sheet).getByRole('textbox', { name: 'SR 제목' })).toHaveValue('접수 제목 내 수정')
  expect(within(sheet).getByRole('textbox', { name: 'SR 본문' })).toHaveValue('원본 본문 내 본문')
  expect(within(sheet).getByRole('checkbox', { name: '알람.txt' })).toBeChecked()
  expect(within(sheet).getByRole('checkbox', { name: '화면.png' })).toBeChecked()
  await userEvent.click(within(sheet).getByRole('button', { name: '저장' }))
  expect(await within(sheet).findByRole('alert')).toHaveTextContent('다른 변경')
  expect(writes).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
})


it('warns on a server 409 after the preflight GET and preserves local input', async () => {
  const sr: SrDetail = { ...draft, title: '원래 제목', status: 'submitted' }
  const onSaved = mount(sr, async (url) => {
    if (url.startsWith('/api/files/')) return jsonResponse(200, files[url.split('/')[3]!])
    if (url.endsWith('/content')) return jsonResponse(409, { message: '다른 변경이 있습니다' })
    return jsonResponse(200, sr)
  })
  const sheet = await screen.findByRole('dialog')
  await userEvent.type(within(sheet).getByRole('textbox', { name: 'SR 제목' }), ' 수정')
  await userEvent.click(within(sheet).getByRole('button', { name: '저장' }))
  expect(await within(sheet).findByRole('alert')).toHaveTextContent('입력은 유지됩니다')
  expect(within(sheet).getByRole('textbox', { name: 'SR 제목' })).toHaveValue('원래 제목 수정')
  expect(onSaved).not.toHaveBeenCalled()
})
