import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { BarsChart } from './charts'

const series = [{ key: 'a', name: '완료' }, { key: 'b', name: '재개' }]
const data = [{ label: '첫째', a: 2, b: 4 }, { label: '둘째', a: 1, b: 0 }]

it('uses semantic foreground colors for stacked bars and matching legends, preserving quantities', () => {
  const { container } = renderWithProviders(<BarsChart data={data} xKey="label" series={series} stacked />)
  const a = screen.getByTitle('완료: 2')
  const b = screen.getByTitle('재개: 4')
  expect(a).toHaveClass('bg-tone-info-fg')
  expect(b).toHaveClass('bg-tone-danger-fg')
  expect(a).toHaveStyle({ width: `${2 / 6 * 100}%` })
  expect(b).toHaveStyle({ width: `${4 / 6 * 100}%` })
  expect(screen.getByText('6')).toBeInTheDocument()
  expect(container.querySelector('span.bg-tone-info-fg')).not.toBeNull()
  expect(container.querySelector('span.bg-tone-danger-fg')).not.toBeNull()
  expect(container.querySelector('[style*="background-color"]')).toBeNull()
})

it('uses a semantic danger color for the maximum without changing bar widths or labels', () => {
  const { container } = renderWithProviders(<BarsChart data={data} xKey="label" series={[series[0]!]} highlightMax />)
  const bars = container.querySelectorAll('div.h-3')
  expect(bars[0]).toHaveClass('bg-tone-danger-fg')
  expect(bars[1]).toHaveClass('bg-tone-info-fg')
  expect(bars[0]!.parentElement).toHaveStyle({ width: '100%' })
  expect(bars[1]!.parentElement).toHaveStyle({ width: '50%' })
  expect(screen.getByRole('img', { name: '완료' }).children).toHaveLength(2)
})
