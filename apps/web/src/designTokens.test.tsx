/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationBell } from './app/NotificationBell'
import { jsonResponse, renderWithProviders } from './test/render'
import { AssistantStatusBadge, PriorityBadge, SrStatusBadge, TaskStatusBadge } from './components/StatusBadges'
import { PRIORITY_CLASS } from './lib/labels'

const css = readFileSync(resolve(import.meta.dirname, 'index.css'), 'utf8')
const tones = ['neutral', 'info', 'violet', 'teal', 'warning', 'success', 'danger'] as const
const rawColorAllowlist = new Set<string>([])

type Oklch = readonly [lightness: number, chroma: number, hue: number]

// Same OKLCH -> OKLab -> linear sRGB conversion as contrast.test.ts.
function luminance([lightness, chroma, hue]: Oklch): number {
  const radians = hue * Math.PI / 180
  const a = chroma * Math.cos(radians), b = chroma * Math.sin(radians)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  return 0.2126 * clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
    + 0.7152 * clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
    + 0.0722 * clamp(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
}

function contrast(first: Oklch, second: Oklch): number {
  const a = luminance(first), b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function declarations(selector: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors!.trim().split(/,\s*/).includes(selector)) continue
    for (const declaration of body!.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon !== -1) values[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim()
    }
  }
  return values
}

function resolveColor(value: string, variables: Record<string, string>): Oklch {
  // Resolve actual CSS aliases and opaque OKLCH surfaces, including shorter hue
  // interpolation and powerless hue for achromatic primary foreground tokens.
  const variable = value.match(/^var\((--[\w-]+)/)
  if (variable) {
    const token = variables[variable[1]!]
    if (!token) throw new Error(`Missing color token: ${variable[1]}`)
    return resolveColor(token, variables)
  }
  const mix = value.match(/^color-mix\(in oklch, (var\(--[\w-]+\)) ([\d.]+)%, (var\(--[\w-]+\))\)$/)
  if (mix) {
    const first = resolveColor(mix[1]!, variables), second = resolveColor(mix[3]!, variables)
    const weight = Number(mix[2]) / 100
    const firstHue = first[1] === 0 ? second[2] : first[2]
    const secondHue = second[1] === 0 ? firstHue : second[2]
    const hueDelta = ((firstHue - secondHue + 540) % 360) - 180
    return [first[0] * weight + second[0] * (1 - weight), first[1] * weight + second[1] * (1 - weight), secondHue + hueDelta * weight]
  }
  const color = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/)
  if (!color) throw new Error(`Unsupported color: ${value}`)
  return [Number(color[1]), Number(color[2]), Number(color[3])]
}

afterEach(() => vi.unstubAllGlobals())

describe('design tokens', () => {
  it('calibrates Markdown contrast conversion with neutral and chromatic sRGB samples', () => {
    expect(contrast([1, 0, 0], [0, 0, 0])).toBeCloseTo(21, 7)
    expect(luminance([0.5, 0, 0])).toBeCloseTo(0.125, 7)
    expect(luminance([0.6279553606, 0.2576833077, 29.2338851923])).toBeCloseTo(0.2126, 6)
  })

  describe.each([':root', '.dark'] as const)('Markdown contrast in %s', (theme) => {
    it.each([
      ['primary', 'primary', 'primary-foreground'],
      ['warning', 'tone-warning-bg', 'tone-warning-fg'],
      ['card', 'card', 'card-foreground'],
    ] as const)('keeps %s bubble text, rich content and borders above 4.5:1', (tone, background, foreground) => {
      const styles = { ...declarations('.md-body'), ...declarations('.md-body[data-tone]'), ...declarations(`.md-body[data-tone="${tone}"]`) }
      const variables = { ...declarations(':root'), ...(theme === '.dark' ? declarations('.dark') : {}), ...styles }
      const color = (value: string) => resolveColor(value, variables)
      const bg = color(`var(--${background})`)
      expect(color('var(--md-background)')).toEqual(bg)
      expect(color('var(--md-foreground)')).toEqual(color(`var(--${foreground})`))
      const surface = (selector: string) => color(declarations(selector).background!)
      const text = color(styles.color!)
      const link = color(declarations('.md-body a').color!)
      const border = (selector: string, property = 'border') => color(declarations(selector)[property]!.replace(/^\d+px solid /, ''))
      const inlineCode = surface('.md-body code'), codeBlock = surface('.md-body pre'), header = surface('.md-body th')
      const pairs: Array<[string, Oklch, Oklch]> = [
        ['body', text, bg], ['link', link, bg],
        ['inline code', text, inlineCode], ['linked inline code', link, inlineCode], ['code block', text, codeBlock],
        ['quote', color(declarations('.md-body blockquote').color!), bg],
        ['quote border', border('.md-body blockquote', 'border-left'), bg],
        ['table cell border', border('.md-body td'), bg],
        ['table header', text, header], ['table header border', border('.md-body th'), header],
      ]
      for (const [element, fg, backdrop] of pairs) {
        const ratio = contrast(fg, backdrop)
        expect(ratio, `${theme} ${tone} ${element}: ${ratio.toFixed(3)}:1`).toBeGreaterThanOrEqual(4.5)
      }
      expect(declarations('.md-body a')['text-decoration']).toBe('underline')
      expect(declarations('.md-body pre code').background).toBe('transparent')
    })
  })

  it('uses semantic colors throughout all application sources', () => {
    const violations: string[] = []
    const rawColor = /(bg|text|border|ring|fill|stroke)-(amber|violet|sky|emerald|rose|red|green|blue|yellow|orange|indigo|purple|pink|teal|cyan|lime|slate|zinc|gray|neutral|stone)-\d{2,3}/g
    for (const entry of readdirSync(import.meta.dirname, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || /\.test\./.test(entry.name)) continue
      const path = resolve(entry.parentPath, entry.name)
      const name = relative(import.meta.dirname, path).split(sep).join('/') // Windows는 역슬래시
      if (rawColorAllowlist.has(name)) continue
      for (const match of readFileSync(path, 'utf8').matchAll(rawColor)) violations.push(`${name}: ${match[0]}`)
    }
    expect(violations).toEqual([])
  })

  it.each([1, 100])('pairs the unread notification badge tokens for %i notifications', async (count) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { count })))
    renderWithProviders(<NotificationBell />)
    const badge = await screen.findByText(count > 99 ? '99+' : String(count))
    expect(badge).toHaveClass('bg-destructive', 'text-primary-foreground')
    expect(badge.closest('button')).toHaveAccessibleName(`알림 ${count}건 미읽음`)
  })

  it('keeps .dark after the only :root block and computes dark tokens on the root', () => {
    const blocks = [...css.matchAll(/(?:^|\n)(:root|\.dark)\s*\{[^}]*\}/g)].map((match) => match[0])
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toContain(':root {')
    expect(blocks[1]).toContain('.dark {')
    expect(css.trimEnd().endsWith(blocks[1].trim())).toBe(true)
    const style = document.createElement('style')
    style.textContent = blocks.join('\n')
    document.head.append(style)
    const originalClass = document.documentElement.className
    try {
      document.documentElement.classList.remove('dark')
      let computed = getComputedStyle(document.documentElement)
      expect(computed.getPropertyValue('--background').trim()).toBe('oklch(0.985 0.002 260)')
      expect(computed.getPropertyValue('--primary').trim()).toBe('oklch(0.45 0.17 262)')
      for (const [tone, hue] of Object.entries({ neutral: 260, info: 250, violet: 295, teal: 190, warning: 75, success: 155, danger: 27 })) {
        expect(computed.getPropertyValue(`--tone-${tone}-bg`).trim()).toBe(`oklch(0.96 ${tone === 'neutral' ? '0.01' : '0.03'} ${hue})`)
        expect(computed.getPropertyValue(`--tone-${tone}-fg`).trim()).toBe(`oklch(0.45 ${tone === 'neutral' ? '0.01' : '0.14'} ${hue})`)
      }
      document.documentElement.classList.add('dark')
      computed = getComputedStyle(document.documentElement)
      const expected = {
        background: '0.17 0.01 265', foreground: '0.96 0.005 260',
        card: '0.205 0.012 265', popover: '0.23 0.012 265',
        primary: '0.70 0.14 262', 'primary-foreground': '0.18 0.03 265',
        muted: '0.26 0.012 265', 'muted-foreground': '0.72 0.015 262',
        accent: '0.30 0.05 262', 'accent-foreground': '0.92 0.03 262',
        border: '1 0 0/9%', input: '1 0 0/14%', ring: '0.65 0.14 262',
        destructive: '0.704 0.191 22',
        'chart-1': '0.67 0.18 262', 'chart-2': '0.72 0.16 300',
        'chart-3': '0.82 0.15 70', 'chart-4': '0.72 0.17 150', 'chart-5': '0.72 0.20 25',
      }
      for (const [token, value] of Object.entries(expected)) {
        expect(computed.getPropertyValue(`--${token}`).trim(), token).toBe(`oklch(${value})`)
      }
      for (const [tone, hue] of Object.entries({ neutral: 260, info: 250, violet: 295, teal: 190, warning: 75, success: 155, danger: 27 })) {
        expect(computed.getPropertyValue(`--tone-${tone}-bg`).trim()).toBe(`oklch(0.28 ${tone === 'neutral' ? '0.01' : '0.05'} ${hue})`)
        expect(computed.getPropertyValue(`--tone-${tone}-fg`).trim()).toBe(`oklch(0.82 ${tone === 'neutral' ? '0.01' : '0.10'} ${hue})`)
      }
    } finally {
      document.documentElement.className = originalClass
      style.remove()
    }
  })

  it('exposes every tone to Tailwind and defines both theme values', () => {
    for (const tone of tones) {
      for (const part of ['bg', 'fg']) {
        expect(css).toContain(`--color-tone-${tone}-${part}: var(--tone-${tone}-${part});`)
        expect(css.match(new RegExp(`--tone-${tone}-${part}: oklch\\(`, 'g'))).toHaveLength(2)
      }
    }
  })

  it('uses paired semantic tones for every status and priority', () => {
    const badges = [
      [<TaskStatusBadge status="todo" />, 'neutral'],
      [<TaskStatusBadge status="in_progress" />, 'info'],
      [<TaskStatusBadge status="on_hold" />, 'warning'],
      [<TaskStatusBadge status="done" />, 'success'],
      [<AssistantStatusBadge status="open" />, 'success'],
      [<AssistantStatusBadge status="developing" />, 'warning'],
      [<AssistantStatusBadge status="testing" />, 'info'],
      [<AssistantStatusBadge status="retired" />, 'neutral'],
      [<SrStatusBadge status="draft" />, 'neutral'],
      [<SrStatusBadge status="submitted" />, 'violet'],
      [<SrStatusBadge status="reviewing" />, 'violet'],
      [<SrStatusBadge status="in_progress" />, 'info'],
      [<SrStatusBadge status="responded" />, 'teal'],
      [<SrStatusBadge status="done" />, 'success'],
      [<SrStatusBadge status="rejected" />, 'danger'],
      [<PriorityBadge priority="low" />, 'neutral'],
      [<PriorityBadge priority="normal" />, 'info'],
      [<PriorityBadge priority="high" />, 'warning'],
      [<PriorityBadge priority="urgent" />, 'danger'],
    ] as const
    for (const [badge, tone] of badges) {
      const { container, unmount } = render(badge)
      expect(container.firstChild).toHaveClass(`bg-tone-${tone}-bg`, `text-tone-${tone}-fg`, 'rounded-full', 'h-5')
      expect(container.firstElementChild?.className).not.toMatch(/dark:|(?:bg|text)-(?:slate|blue|amber|emerald|violet|red|teal)-\d/)
      unmount()
    }
    for (const classes of Object.values(PRIORITY_CLASS)) expect(classes).toMatch(/^bg-tone-(\w+)-bg text-tone-\1-fg$/)
  })

  it('loads Pretendard Variable from the local package', () => {
    expect(css).toContain('@import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";')
    expect(css).toContain("--font-sans: 'Pretendard Variable'")
    const fontCss = readFileSync(resolve(import.meta.dirname, '../node_modules/pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'), 'utf8')
    const urls = [...fontCss.matchAll(/src:\s*url\(([^)]+)\)/g)]
    expect(urls.length).toBeGreaterThan(0)
    for (const [, url] of urls) {
      expect(url).toMatch(/^\.\/woff2-dynamic-subset\/.+\.woff2$/)
      expect(readFileSync(resolve(import.meta.dirname, `../node_modules/pretendard/dist/web/variable/${url}`)).length).toBeGreaterThan(0)
    }
  })

  it('has no text below 11px or bare rounded utilities in application sources', () => {
    const sourceRoot = import.meta.dirname
    const violations: string[] = []
    for (const entry of readdirSync(sourceRoot, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:tsx?|css)$/.test(entry.name) || /\.test\./.test(entry.name)) continue
      const path = `${entry.parentPath}/${entry.name}`
      const source = readFileSync(path, 'utf8')
      if (/text-\[(?:[0-9]|10)px\]|(?<![\w-])rounded(?![\w-])/.test(source)) violations.push(path)
    }
    expect(violations).toEqual([])
  })
})
