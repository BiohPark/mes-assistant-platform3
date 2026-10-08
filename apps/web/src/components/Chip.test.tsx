import { readFileSync } from 'node:fs'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { Chip } from './Chip'

it('filter chips distinguish unselected, selected, hover, and disabled with a Check', () => {
  const onClick = vi.fn()
  const { rerender } = render(<Chip label="Filter" variant="filter" onClick={onClick} />)
  const button = screen.getByRole('button', { name: 'Filter' })
  expect(button.parentElement).toHaveClass('border-muted-foreground/30', 'hover:border-foreground')
  expect(button.querySelector('.lucide-check')).toBeNull()
  rerender(<Chip label="Filter" variant="filter" selected onClick={onClick} />)
  expect(button).toHaveAttribute('aria-pressed', 'true')
  expect(button.parentElement).toHaveClass('bg-primary', 'text-primary-foreground', 'font-semibold')
  expect(button.parentElement).not.toHaveClass('hover:bg-muted')
  expect(button.querySelector('.lucide-check')).not.toBeNull()
  rerender(<Chip label="Filter" variant="filter" selected disabled onClick={onClick} />)
  expect(button).toBeDisabled()
  expect(button.parentElement).toHaveClass('opacity-50')
  fireEvent.click(button)
  expect(onClick).not.toHaveBeenCalled()
})

// Convert the actual OKLCH theme tokens to linear sRGB luminance (WCAG contrast).
function luminance(token: string) {
  const [lightness, chroma, hue] = token.match(/[\d.]+/g)!.map(Number)
  const radians = hue * Math.PI / 180
  const a = chroma * Math.cos(radians), b = chroma * Math.sin(radians)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
  const clamp = (value: number) => Math.max(0, Math.min(1, value))
  return 0.2126 * clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
    + 0.7152 * clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
    + 0.0722 * clamp(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
}
it.each([':root', '.dark'])('uses theme colors with at least 4.5:1 contrast for filters: %s', selector => {
  const css = readFileSync(`${import.meta.dirname}/../index.css`, 'utf8')
  const block = css.slice(css.indexOf(`${selector} {`)).split('}')[0]
  const color = (name: string) => luminance(block.match(new RegExp(`--${name}: (oklch\\([^;]+\\));`))![1])
  for (const [background, foreground] of [['primary', 'primary-foreground'], ['card', 'foreground']] as const) {
    const bg = color(background), fg = color(foreground)
    expect((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05)).toBeGreaterThanOrEqual(4.5)
  }
})
