import { screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ActivityLog } from '@mes/domain'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n'
import { ACTIVITY_KEY } from '@/lib/labels'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { ActivityPanel } from './ActivityPanel'

afterEach(() => vi.unstubAllGlobals())

// Enumerated from apps/api/src activityLog writes (including dynamic task/request
// statuses, seedScale and imported demo fixtures), independently of UI mappings.
const SERVER_ACTIVITY_TYPES = [
  'task.created', 'task.started', 'task.completed', 'task.reopened', 'task.hold', 'task.status_changed',
  'checklist.checked', 'checklist.unchecked', 'checklist.reviewed',
  'file.uploaded', 'file.tagged_output', 'input.selected', 'input.removed',
  'context.selected', 'context.removed', 'context.refreshed', 'note.added', 'message.sent',
  'thread.created', 'model.changed', 'feedback.given', 'tag.added', 'tag.removed',
  'sr.created', 'sr.submitted', 'sr.status_changed', 'sr.task_started',
  'request.started', 'request.completed', 'request.cancelled', 'request.failed',
] as const

function mount(types: readonly string[], locale: 'ko' | 'en' = 'ko') {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [{ id: 'u', name: '사용자', initials: '사', color: 'var(--primary)', isSystemOwner: false, isBusinessOwner: false }])))
  const activity: ActivityLog[] = types.map((type, index) => ({
    id: String(index), type: type as ActivityLog['type'], userId: 'u', at: '2026-10-01T00:00:00.000Z', payload: {},
  }))
  return renderWithProviders(<I18nProvider locale={locale}><TooltipProvider><ActivityPanel activity={activity} /></TooltipProvider></I18nProvider>)
}

it.each(['ko', 'en'] as const)('maps every server activity type to localized text and a specific icon in %s', (locale) => {
  mount(SERVER_ACTIVITY_TYPES, locale)
  const rows = screen.getAllByRole('listitem')
  expect(rows).toHaveLength(SERVER_ACTIVITY_TYPES.length)
  rows.forEach((row, index) => {
    expect(row).not.toHaveTextContent(SERVER_ACTIVITY_TYPES[index]!)
    expect(row).not.toHaveTextContent(locale === 'ko' ? '기타 활동' : 'Other activity')
    expect(row.querySelector('svg.lucide-history')).toBeNull()
    expect(row.querySelector('svg.lucide')).toHaveAttribute('aria-hidden', 'true')
  })
})

it.each([
  ['ko', ['AI 요청 시작', 'AI 요청 완료', 'AI 요청 취소', 'AI 요청 실패']],
  ['en', ['AI request started', 'AI request completed', 'AI request cancelled', 'AI request failed']],
] as const)('shows the request lifecycle with distinct icons in %s', (locale, labels) => {
  mount(['request.started', 'request.completed', 'request.cancelled', 'request.failed'], locale)
  const rows = screen.getAllByRole('listitem')
  const icons = ['play', 'circle-check', 'circle-x', 'circle-alert']
  rows.forEach((row, index) => {
    expect(row).toHaveTextContent(labels[index]!)
    expect(row.querySelector(`svg.lucide-${icons[index]}`)).not.toBeNull()
  })
})

it('gives every activity type a decorative Lucide icon without replacing its text', () => {
  const types = Object.keys(ACTIVITY_KEY) as ActivityLog['type'][]
  mount(types)
  const rows = screen.getAllByRole('listitem')
  expect(rows).toHaveLength(32)
  for (const row of rows) {
    const icon = row.querySelector('svg.lucide')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(within(row).queryByRole('img')).not.toBeInTheDocument()
    expect(row).toHaveTextContent('시스템')
  }
  expect(rows[2]).toHaveTextContent('완료')
})

it('distinguishes warning, success, selection, removal and tag activity with icons and semantic tones', () => {
  mount(['task.reopened', 'task.hold', 'task.completed', 'input.selected', 'input.removed', 'tag.added', 'sr.task_started'])
  const expected = [
    ['rotate-ccw', 'warning'], ['pause', 'warning'], ['circle-check', 'success'],
    ['file-input', 'violet'], ['file-minus', 'neutral'], ['tag', 'info'], ['play', 'info'],
  ]
  const rows = screen.getAllByRole('listitem')
  expected.forEach(([icon, tone], index) => {
    const svg = rows[index]!.querySelector(`svg.lucide-${icon}`)
    expect(svg).not.toBeNull()
    expect(svg).toHaveClass(`text-tone-${tone}-fg`)
    expect(rows[index]!.querySelector('span.text-tone-' + tone + '-fg')).not.toBeNull()
  })
})

it('keeps the empty activity message without a synthetic event icon', () => {
  const { container } = mount([])
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  expect(screen.getByText('이력이 없습니다.')).toBeInTheDocument()
  expect(container.querySelector('svg.lucide')).toBeNull()
})

it.each([
  ['ko', '기타 활동'], ['en', 'Other activity'],
] as const)('uses a generic localized label for a future activity type in %s', (locale, label) => {
  mount(['future.event'], locale)
  const row = screen.getByRole('listitem')
  expect(row).toHaveTextContent(label)
  expect(row).not.toHaveTextContent('future.event')
  expect(row.querySelector('svg.lucide-history')).toHaveAttribute('aria-hidden', 'true')
})
