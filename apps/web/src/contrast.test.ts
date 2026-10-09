/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(import.meta.dirname, 'index.css'), 'utf8')
type Oklch = readonly [lightness: number, chroma: number, hue: number]

function luminance([lightness, chroma, hue]: Oklch): number {
  // OKLCH -> OKLab -> LMS -> linear sRGB. Clamp out-of-gamut channels
  // before WCAG luminance; these channels are already linear, not encoded sRGB.
  const radians = hue * Math.PI / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(first: Oklch, second: Oklch): number {
  const a = luminance(first)
  const b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function themeTokens(selector: ':root' | '.dark'): Map<string, Oklch> {
  const block = [...css.matchAll(/(?:^|\n)(:root|\.dark)\s*\{([^}]*)\}/g)].find((match) => match[1] === selector)
  if (!block) throw new Error(`Missing theme: ${selector}`)
  const tokens = new Map<string, Oklch>()
  for (const [, name, l, c, h] of block[2]!.matchAll(/--([\w-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g)) {
    tokens.set(name!, [Number(l), Number(c), Number(h)])
  }
  return tokens
}

describe('warning contrast', () => {
  it('calibrates WCAG luminance against black, white and neutral OKLab samples', () => {
    expect(luminance([0, 0, 0])).toBe(0)
    expect(luminance([1, 0, 0])).toBeCloseTo(1, 7)
    expect(luminance([0.5, 0, 0])).toBeCloseTo(0.125, 7)
    expect(contrast([1, 0, 0], [0, 0, 0])).toBeCloseTo(21, 7)
    expect(contrast([0, 0, 0], [0.5, 0, 0])).toBeCloseTo(3.5, 7)
    // sRGB red in OKLCH exercises both chroma and hue, not only neutral lightness.
    expect(luminance([0.6279553606, 0.2576833077, 29.2338851923])).toBeCloseTo(0.2126, 6)
  })

  describe.each([':root', '.dark'] as const)('%s', (selector) => {
    it.each(['tone-warning-fg', 'foreground'])('%s on tone-warning-bg meets WCAG AA (4.5:1)', (foreground) => {
      const tokens = themeTokens(selector)
      const fg = tokens.get(foreground)
      const bg = tokens.get('tone-warning-bg')
      expect(fg, `${selector} --${foreground}`).toBeDefined()
      expect(bg, `${selector} --tone-warning-bg`).toBeDefined()
      const ratio = contrast(fg!, bg!)
      expect(ratio, `${selector}: --${foreground} on --tone-warning-bg = ${ratio.toFixed(3)}:1`).toBeGreaterThanOrEqual(4.5)
    })
  })
})
