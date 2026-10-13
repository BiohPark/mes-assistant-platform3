import { fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Task } from '@mes/domain'
import { MeContext } from '@/app/auth'
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
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system' as const, locale: 'ko' as const }}><TooltipProvider><RelatedStrip tags={base.tags} excludeTaskId={base.id} /></TooltipProvider></MeContext>)
  const button = await screen.findByText('같은 태그 대화 1')
  fireEvent.click(button)
  expect(screen.getByRole('link', { name: /WK-2026-0002.*관련 대화/ })).toHaveAttribute('href', '/c/other')
  expect(calls.filter((url) => url.startsWith('/api/tasks?')).length).toBe(2)
})

it('limits the summary to three avatars and a remainder while keeping every related link', async () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({ ...base, id: `other-${index}`, code: `WK-2026-000${index + 2}`, title: `관련 ${index}`, tags: ['첫째'] }))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => jsonResponse(200, url === '/api/assistants'
    ? [{ id: 'a', name: 'URS Analyst', color: 'var(--primary)', summary: '', level1: '상위', level2: '하위', level1CodeId: 'l1', level2CodeId: 'l2', order: 0, ownerId: 'u', status: 'open', expectedInputs: [], expectedOutputs: [], usageExample: '', checklistTemplate: [], createdBy: 'u', createdAt: base.createdAt, updatedAt: base.createdAt, revision: 0 }] : [base, ...rows])))
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><RelatedStrip tags={base.tags} excludeTaskId={base.id} /></MeContext>)
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

const me = { id: 'u', name: '사용자', role: '', roles: ['member' as const], theme: 'system' as const, locale: 'ko' as const }
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
