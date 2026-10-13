import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { ThemeProvider } from 'next-themes'
import type { Task } from '@mes/domain'
import { MeContext } from '@/app/auth'
import { ProfileProvider } from '@/app/profile'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { RelatedStrip } from './RelatedStrip'
import { createT } from '@/i18n'

const base = { id: 't', code: 'WK-2026-0001', assistantId: 'a', title: '원본', titleSource: 'default', summary: '', status: 'in_progress', ownerId: 'u', assigneeIds: ['u'], priority: 'normal', tags: ['첫째', '둘째'], checklist: [], inputs: [], outputFileIds: [], threadId: 'h', createdAt: '2026-09-28T00:00:00.000Z', createdBy: 'u', lastActivityAt: '2026-09-28T00:00:00.000Z' } satisfies Task
afterEach(() => vi.unstubAllGlobals())

it('finds conversations sharing either tag and removes the current conversation', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    if (url === '/api/assistants') return jsonResponse(200, [])
    if (url.includes('tag%5B%5D=%EB%91%98%EC%A7%B8')) return jsonResponse(200, [{ ...base, id: 'other', code: 'WK-2026-0002', title: '관련 대화', tags: ['둘째'] }])
    return jsonResponse(200, [base])
  }))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><RelatedStrip tags={base.tags} excludeTaskId={base.id} /></TooltipProvider></MeContext>)
  const button = await screen.findByText('같은 태그 대화 1')
  fireEvent.click(button)
  expect(screen.getByRole('link', { name: /WK-2026-0002.*관련 대화/ })).toHaveAttribute('href', '/c/other')
  expect(calls.filter((url) => url.startsWith('/api/tasks?')).length).toBe(2)
})

it('limits the summary to three avatars and a remainder while keeping every related link', async () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({ ...base, id: `other-${index}`, code: `WK-2026-000${index + 2}`, title: `관련 ${index}`, tags: ['첫째'] }))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => jsonResponse(200, url === '/api/assistants'
    ? [{ id: 'a', name: 'URS Analyst', color: 'var(--primary)', summary: '', level1: '상위', level2: '하위', level1CodeId: 'l1', level2CodeId: 'l2', order: 0, ownerId: 'u', status: 'open', expectedInputs: [], expectedOutputs: [], usageExample: '', checklistTemplate: [], createdBy: 'u', createdAt: base.createdAt, updatedAt: base.createdAt, revision: 0 }] : [base, ...rows])))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member'], theme: 'system', locale: 'ko' }}><RelatedStrip tags={base.tags} excludeTaskId={base.id} /></MeContext>)
  const summary = (await screen.findByText('같은 태그 대화 5')).closest('summary')!
  expect(summary.querySelectorAll('.ring-2.ring-background')).toHaveLength(3)
  for (const avatar of summary.querySelectorAll('.ring-2.ring-background')) {
    expect(avatar).toHaveTextContent(/^U$/)
    expect(avatar).toHaveClass('size-5')
  }
  expect(screen.getByText('+2')).toBeInTheDocument()
  fireEvent.click(summary)
  expect(screen.getAllByRole('link')).toHaveLength(5)
  for (const link of screen.getAllByRole('link')) {
    expect(link.firstElementChild).toHaveTextContent(/^URS$/)
  }
  const popup = screen.getByText('같은 태그를 가진 대화').parentElement!
  expect(popup).toHaveClass('fixed', 'inset-x-4', 'w-auto', 'sm:absolute', 'sm:inset-x-auto', 'sm:left-0', 'sm:w-[22rem]')
})

const me = { id: 'u', name: '사용자', role: '', email: null, emailIsDefault: false, roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }
const mount = (tags: string[]) => renderWithProviders(<MeContext value={me}><TooltipProvider><RelatedStrip tags={tags} excludeTaskId="t" /></TooltipProvider></MeContext>)

it('groups related conversations by tag — a conversation sharing two tags is listed under both, counted once', async () => {
  const both = { ...base, id: 'both', code: 'WK-2026-0007', title: '둘 다 공유', tags: ['첫째', '둘째'] }
  const first = { ...base, id: 'first', code: 'WK-2026-0008', title: '첫째만', tags: ['첫째'] }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => jsonResponse(200, url === '/api/assistants' ? [] : url.includes('%EB%91%98%EC%A7%B8') ? [base, both] : [base, both, first])))
  mount(['첫째', '둘째'])
  fireEvent.click(await screen.findByText('같은 태그 대화 2'))
  const groups = screen.getByText('같은 태그를 가진 대화').nextElementSibling!.children
  expect(groups).toHaveLength(2)
  expect(groups[0]).toHaveTextContent('첫째')
  expect(groups[0]!.querySelectorAll('a')).toHaveLength(2)
  expect(groups[1]).toHaveTextContent('둘째')
  expect(groups[1]!.querySelectorAll('a')).toHaveLength(1)
  expect(groups[1]!.querySelector('a')).toHaveAttribute('href', '/c/both')
})

it('tells apart no related conversations, loading, and a failed lookup with retry', async () => {
  let fail = true
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/assistants' ? jsonResponse(200, []) : fail ? jsonResponse(500, { message: '서버 오류' }) : jsonResponse(200, [base])))
  const { container } = mount(['첫째'])
  expect(screen.getByText('같은 태그 대화 찾는 중…').closest('span')).toHaveAttribute('aria-busy', 'true')
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('같은 태그 대화를 불러오지 못했습니다')
  fail = false
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByText('같은 태그 대화 없음')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(container.querySelector('details')).toBeNull()
})

it('shows loading, not "none", while a changed tag set is still being looked up', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const other = { ...base, id: 'other', code: 'WK-2026-0002', title: '관련 대화', tags: ['첫째'] }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/assistants') return jsonResponse(200, [])
    if (url.includes('%EB%91%98%EC%A7%B8')) { await gate; return jsonResponse(200, [base]) }
    return jsonResponse(200, [base, other])
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (tags: string[]) => <QueryClientProvider client={client}><ThemeProvider attribute="class" defaultTheme="system" storageKey="mes-theme" disableTransitionOnChange><ProfileProvider><MeContext value={me}><TooltipProvider><MemoryRouter><RelatedStrip tags={tags} excludeTaskId="t" /></MemoryRouter></TooltipProvider></MeContext></ProfileProvider></ThemeProvider></QueryClientProvider>
  const view = render(tree(['첫째']))
  await screen.findByText('같은 태그 대화 1')
  view.rerender(tree(['둘째']))
  expect(screen.getByText('같은 태그 대화 찾는 중…')).toBeInTheDocument()
  expect(screen.queryByText('같은 태그 대화 없음')).not.toBeInTheDocument()
  expect(screen.queryByText('같은 태그 대화 1')).not.toBeInTheDocument()
  release()
  await screen.findByText('같은 태그 대화 없음')
})

it('renders nothing without tags and performs no lookup', () => {
  const fetchMock = vi.fn(async (_url: string) => jsonResponse(200, []))
  vi.stubGlobal('fetch', fetchMock)
  const { container } = mount([])
  expect(container.querySelector('span, details')).toBeNull()
  expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/tasks'))).toBe(false)
})

it('describes the tag relationship in both locales with the count intact', () => {
  expect(createT('ko')('task.related.linked', { count: 2 })).toBe('같은 태그 대화 2')
  expect(createT('en')('task.related.linked', { count: 2 })).toBe('Same-tag conversations 2')
})

// S11 U2 — 같은 태그 펼침 패널에서 대화 본문·파일 버전을 골라 담기
type Route = (url: string, init?: RequestInit) => Response | undefined
const file = (id: string, name: string, version: number, previousId?: string) => ({ id, originTaskId: 'd', name, mime: 'text/plain', size: 10, sha256: id, source: 'upload' as const, isOutput: false, version, ...(previousId && { previousId }), uploadedBy: 'u', uploadedAt: `2026-09-28T00:00:0${version}.000Z` })
const direct = { ...base, id: 'd', code: 'WK-2026-0011', title: '직접 공유', tags: ['첫째'] }
const conversation = (taskId: string, code: string, selected?: boolean) => ({ taskId, code, title: code, status: 'in_progress', assistant: { id: 'a', name: 'A', color: '' }, sharedTags: ['첫째'], messageCount: 2, bytes: 10, lastActivityAt: base.lastActivityAt,
  ...(selected && { selected: { weight: 'reference', mode: 'full', snapshotId: 's', newMessages: 0, detached: false } }) })
function serve(related: Task[], route: Route) {
  const calls: Array<[string, string]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([init?.method ?? 'GET', url])
    const routed = route(url, init)
    if (routed) return routed
    if (url === '/api/assistants') return jsonResponse(200, [])
    if (url === '/api/tasks/t') return jsonResponse(200, base)
    if (url.startsWith('/api/tasks?')) return jsonResponse(200, [base, ...related])
    return jsonResponse(404, { message: url })
  }))
  return calls
}
async function openPanel(count: number) { fireEvent.click(await screen.findByText(`같은 태그 대화 ${count}`)) }

it('indirect tag not listed — only direct-tag rows get an unchecked full-snapshot checkbox, nothing is preloaded', async () => {
  const indirect = { ...base, id: 'i', code: 'WK-2026-0012', title: '간접 연결', tags: ['셋째'] }
  const calls = serve([direct, indirect], (url) => url === '/api/tasks/t/candidates' ? jsonResponse(200, { files: [], conversations: [conversation('d', direct.code)] }) : undefined)
  mount(['첫째'])
  await openPanel(1)
  expect(screen.queryByText('간접 연결')).not.toBeInTheDocument()
  const boxes = await screen.findAllByRole('checkbox')
  expect(boxes).toHaveLength(1)
  expect(boxes[0]).toHaveAccessibleName('WK-2026-0011 대화 본문(전체 스냅샷) 담기')
  expect(boxes[0]).not.toBeChecked()
  expect(screen.getByRole('button', { name: /^담기/ })).toBeDisabled()
  // 파일은 펼칠 때만 불러온다
  expect(calls.some(([, url]) => url.endsWith('/files'))).toBe(false)
})

it('partial failure shows remaining — sequential add stops at the failure, retry sends only what is left, added rows become checked and disabled', async () => {
  const other = { ...base, id: 'e', code: 'WK-2026-0013', title: '두 번째', tags: ['첫째'] }
  const added = new Set<string>()
  let failFile = true
  const calls = serve([direct, other], (url, init) => {
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [conversation('d', direct.code, added.has('d')), conversation('e', other.code, added.has('e'))] })
    if (url === '/api/tasks/d/files') return jsonResponse(200, [file('f1', 'spec.txt', 1)])
    if (url === '/api/tasks/t/inputs/f1' && init?.method === 'PUT') return failFile ? jsonResponse(400, { message: '후보에 없는 파일입니다' }) : new Response(null, { status: 204 })
    const match = /\/api\/tasks\/t\/conversation-inputs\/(\w+)$/.exec(url)
    if (match && init?.method === 'PUT') { added.add(match[1]!); return jsonResponse(200, {}) }
    return undefined
  })
  mount(['첫째'])
  await openPanel(2)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'WK-2026-0011 대화 본문(전체 스냅샷) 담기' }))
  fireEvent.click(screen.getByRole('button', { name: 'WK-2026-0011 파일 펼치기' }))
  fireEvent.click(await screen.findByRole('radio', { name: 'v1' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'WK-2026-0013 대화 본문(전체 스냅샷) 담기' }))
  fireEvent.click(screen.getByRole('button', { name: '담기 · 3' }))
  const results = await screen.findByRole('list', { name: '담기 결과' })
  expect(await within(results).findByText('실패 — 후보에 없는 파일입니다')).toBeInTheDocument()
  expect(within(results).getByText('WK-2026-0011').closest('li')).toHaveTextContent('담음')
  expect(within(results).getByText('WK-2026-0013').closest('li')).toHaveTextContent('미처리')
  expect(screen.getByText('담음 1 · 실패 1 · 미처리 1')).toBeInTheDocument()
  expect(calls.some(([method, url]) => method === 'PUT' && url.endsWith('/conversation-inputs/e'))).toBe(false)
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'WK-2026-0011 대화 본문(전체 스냅샷) 담기' })).toBeDisabled())
  expect(screen.getByRole('checkbox', { name: 'WK-2026-0011 대화 본문(전체 스냅샷) 담기' })).toBeChecked()
  failFile = false
  const before = calls.length
  fireEvent.click(screen.getByRole('button', { name: '재시도' }))
  await screen.findByText('담음 2 · 실패 0 · 미처리 0')
  const writes = calls.slice(before).filter(([method]) => method !== 'GET').map(([method, url]) => `${method} ${url}`)
  expect(writes).toEqual(['PUT /api/tasks/t/inputs/f1', 'PUT /api/tasks/t/conversation-inputs/e'])
})

it('same chain radio — versions linked by previousId share one radio group, the added version is fixed and another version switches', async () => {
  const calls = serve([direct], (url) => {
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [{ file: file('f1', 'plan.txt', 1), sourceTaskId: 'd', viaTags: ['첫째'], role: 'upload', selected: 'reference', newerVersionId: 'f3' }], conversations: [conversation('d', direct.code)] })
    if (url === '/api/tasks/d/files') return jsonResponse(200, [file('f1', 'plan.txt', 1), file('g1', 'other.txt', 1), file('f2', 'plan.txt', 2, 'f1'), file('f3', 'plan.txt', 3, 'f2')])
    if (url.endsWith('/switch-version')) return new Response(null, { status: 204 })
    return undefined
  })
  mount(['첫째'])
  await openPanel(1)
  fireEvent.click(await screen.findByRole('button', { name: 'WK-2026-0011 파일 펼치기' }))
  const plan = await screen.findByRole('radiogroup', { name: 'plan.txt 버전' })
  const radios = within(plan).getAllByRole('radio')
  expect(radios.map((radio) => radio.getAttribute('aria-label') ?? radio.closest('label')!.textContent)).toEqual(['v3', 'v2', 'v1'])
  expect(within(plan).getByRole('radio', { name: 'v1' })).toBeChecked()
  expect(within(plan).getByRole('radio', { name: 'v1' })).toBeDisabled()
  expect(within(plan).getByRole('radio', { name: 'v3' })).not.toBeChecked()
  const other = screen.getByRole('radiogroup', { name: 'other.txt 버전' })
  expect(within(other).getByRole('radio', { name: 'v1' })).not.toBeChecked()
  fireEvent.click(within(plan).getByRole('radio', { name: 'v3' }))
  expect(within(plan).getByRole('radio', { name: 'v3' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '담기 · 1' }))
  await screen.findByText('담음 1 · 실패 0 · 미처리 0')
  const switched = (fetch as unknown as { mock: { calls: Array<[string, RequestInit?]> } }).mock.calls.find(([url]) => url.endsWith('/switch-version'))!
  expect(switched[0]).toBe('/api/tasks/t/inputs/f1/switch-version')
  expect(JSON.parse(String(switched[1]!.body))).toEqual({ toFileId: 'f3' })
  expect(calls.some(([method, url]) => method === 'PUT' && url.includes('/inputs/'))).toBe(false)
})

it('loads files lazily and shows at most 20 version chains with the rest counted', async () => {
  serve([direct], (url) => {
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [conversation('d', direct.code)] })
    if (url === '/api/tasks/d/files') return jsonResponse(200, Array.from({ length: 25 }, (_, index) => file(`x${index}`, `file-${index}.txt`, 1)))
    return undefined
  })
  mount(['첫째'])
  await openPanel(1)
  fireEvent.click(await screen.findByRole('button', { name: 'WK-2026-0011 파일 펼치기' }))
  expect(await screen.findAllByRole('radiogroup')).toHaveLength(20)
  expect(screen.getByText('외 5개는 자료 탭에서')).toBeInTheDocument()
})

it('keeps draft rows as plain links — no add controls and no candidate lookup without a conversation', async () => {
  const calls = serve([direct], () => undefined)
  renderWithProviders(<MeContext value={me}><TooltipProvider><RelatedStrip tags={['첫째']} /></TooltipProvider></MeContext>)
  await openPanel(2)
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^담기/ })).not.toBeInTheDocument()
  expect(calls.some(([, url]) => url.includes('/candidates'))).toBe(false)
})

it('disables adding into a completed conversation', async () => {
  serve([direct], (url) => {
    if (url === '/api/tasks/t') return jsonResponse(200, { ...base, status: 'done' })
    if (url === '/api/tasks/t/candidates') return jsonResponse(200, { files: [], conversations: [conversation('d', direct.code)] })
    return undefined
  })
  mount(['첫째'])
  await openPanel(1)
  expect(await screen.findByText('완료된 대화에는 담을 수 없습니다')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'WK-2026-0011 대화 본문(전체 스냅샷) 담기' })).toBeDisabled()
})
