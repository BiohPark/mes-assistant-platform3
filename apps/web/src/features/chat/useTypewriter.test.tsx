import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTypewriter } from './useTypewriter'

const chunk = 'x'.repeat(100)
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z')) })
afterEach(() => { vi.useRealTimers(); Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({ matches: false, media: query, addListener() {}, removeListener() {} }) }) })

function setup(text = 'abc', active = true) {
  return renderHook(({ text, active }) => useTypewriter(text, active), { initialProps: { text, active } })
}

it('shows text that already existed at mount at once and releases a new chunk evenly until the next one', () => {
  const { result, rerender } = setup()
  expect(result.current).toBe('abc')
  act(() => vi.advanceTimersByTime(1000)) // 세션 폴링 간격만큼 조용하다가 조각이 온다
  rerender({ text: `abc${chunk}`, active: true })
  expect(result.current.length).toBeLessThan(10)
  act(() => vi.advanceTimersByTime(500))
  expect(result.current.length).toBeGreaterThan(40)
  expect(result.current.length).toBeLessThan(65)
  act(() => vi.advanceTimersByTime(600))
  expect(result.current).toBe(`abc${chunk}`)
})

it('speeds up when the next chunk arrives before the backlog is released', () => {
  const { result, rerender } = setup('')
  act(() => vi.advanceTimersByTime(1000))
  rerender({ text: chunk, active: true })
  act(() => vi.advanceTimersByTime(500))
  const shown = result.current.length
  expect(shown).toBeLessThan(100)
  rerender({ text: chunk + chunk, active: true })
  // 남은 분량(약 150자)을 다음 조각 간격(500ms) 안에 풀어야 한다
  act(() => vi.advanceTimersByTime(560))
  expect(result.current).toBe(chunk + chunk)
})

it('finishes at once when streaming ends', () => {
  const { result, rerender } = setup('')
  act(() => vi.advanceTimersByTime(1000))
  rerender({ text: chunk, active: true })
  expect(result.current.length).toBeLessThan(100)
  rerender({ text: chunk, active: false })
  expect(result.current).toBe(chunk)
})

it('shows new text at once when reduced motion is preferred', () => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({ matches: query.includes('reduce'), media: query, addListener() {}, removeListener() {} }) })
  const { result, rerender } = setup('')
  rerender({ text: chunk, active: true })
  expect(result.current).toBe(chunk)
})

it('restarts from the common prefix when the server replaces the text', () => {
  const { result, rerender } = setup('')
  act(() => vi.advanceTimersByTime(1000))
  rerender({ text: 'hello world', active: true })
  act(() => vi.advanceTimersByTime(2000))
  expect(result.current).toBe('hello world')
  rerender({ text: 'hello there, friend', active: true })
  expect('hello there, friend'.startsWith(result.current)).toBe(true)
  act(() => vi.advanceTimersByTime(2000))
  expect(result.current).toBe('hello there, friend')
})

it('never splits a surrogate pair', () => {
  const { result, rerender } = setup('')
  act(() => vi.advanceTimersByTime(1000))
  const emoji = '\u{1F600}'.repeat(50)
  rerender({ text: emoji, active: true })
  for (let i = 0; i < 30; i++) {
    act(() => vi.advanceTimersByTime(40))
    expect(result.current.length % 2).toBe(0)
  }
})
