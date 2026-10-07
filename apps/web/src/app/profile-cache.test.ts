/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const html = readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8')
function applyCache() {
  const script = html.match(/<script id="profile-cache">([\s\S]*?)<\/script>/)?.[1]
  expect(script).toBeDefined()
  expect(html.indexOf('id="profile-cache"')).toBeLessThan(html.indexOf('</head>'))
  window.eval(script!)
}

describe('첫 페인트 전 프로필 캐시', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); document.documentElement.className = ''; document.documentElement.lang = 'ko'; document.documentElement.style.colorScheme = '' })
  it.each([['dark', 'en', false, true], ['light', 'ko', true, false], ['system', 'en', true, true], ['system', 'ko', false, false]])('캐시 %s·%s와 시스템 선호를 선적용한다', (theme, locale, systemDark, dark) => {
    localStorage.setItem('mes-theme', theme)
    localStorage.setItem('mes-locale', locale)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: systemDark })))
    document.documentElement.classList.add('dark')
    applyCache()
    expect(document.documentElement.classList.contains('dark')).toBe(dark)
    expect(document.documentElement.style.colorScheme).toBe(dark ? 'dark' : 'light')
    expect(document.documentElement.lang).toBe(locale)
  })
  it.each([false, true])('캐시 없거나 잘못된 값은 system·ko로 해석한다 (dark=%s)', (dark) => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: dark })))
    for (const invalid of [false, true]) {
      if (invalid) { localStorage.setItem('mes-theme', 'other'); localStorage.setItem('mes-locale', 'ja') }
      applyCache()
      expect(document.documentElement.classList.contains('dark')).toBe(dark)
      expect(document.documentElement.lang).toBe('ko')
      if (invalid) {
        expect(localStorage.getItem('mes-theme')).toBe('system')
        expect(localStorage.getItem('mes-locale')).toBe('ko')
      }
    }
  })
  it('저장소 접근이 막혀도 시스템 테마·ko를 적용한다', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    applyCache()
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.lang).toBe('ko')
  })
})
