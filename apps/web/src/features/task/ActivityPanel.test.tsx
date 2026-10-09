import { screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ActivityLog } from '@mes/domain'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ACTIVITY_KEY } from '@/lib/labels'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { ActivityPanel } from './ActivityPanel'

afterEach(() => vi.unstubAllGlobals())

function mount(types: ActivityLog['type'][]) {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [{ id: 'u', name: '사용자', initials: '사', color: 'var(--primary)', isSystemOwner: false, isBusinessOwner: false }])))
  const activity: ActivityLog[] = types.map((type, index) => ({
    id: String(index), type, userId: 'u', at: '2026-10-01T00:00:00.000Z', payload: {},
  }))
  return renderWithProviders(<TooltipProvider><ActivityPanel activity={activity} /></TooltipProvider>)
}

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

it('preserves the raw label for a future activity type without breaking the history list', () => {
  mount(['future.event' as ActivityLog['type']])
  const row = screen.getByRole('listitem')
  expect(row).toHaveTextContent('future.event')
  expect(row.querySelector('svg.lucide-history')).toHaveAttribute('aria-hidden', 'true')
})
