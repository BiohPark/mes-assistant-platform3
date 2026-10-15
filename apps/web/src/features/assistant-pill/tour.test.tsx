import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PAGE_ACTIONS } from './pageActions'
import { TOUR_STEPS, tourTarget, useTourStore } from './tour'

function target(id: string, display = '') {
  const element = document.createElement('div')
  element.dataset.tour = id
  element.style.display = display
  document.body.append(element)
  return element
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => { useTourStore.getState().close(); document.querySelectorAll('[data-tour]').forEach(element => element.remove()); vi.useRealTimers() })

it('every page has steps and ends at the pill, which exists on every page', () => {
  for (const route of Object.keys(PAGE_ACTIONS) as (keyof typeof PAGE_ACTIONS)[]) {
    expect(TOUR_STEPS[route].length).toBeGreaterThan(0)
    expect(TOUR_STEPS[route].at(-1)?.target).toBe('pill')
  }
})

it('picks the first shown target — hidden duplicates (display:none, e.g. the other breakpoint tablist) are ignored', () => {
  const hidden = target('task-tabs', 'none')
  const shown = target('task-tabs')
  expect(tourTarget('task-tabs')).toBe(shown)
  hidden.remove(); shown.remove()
  expect(tourTarget('task-tabs')).toBeUndefined()
})

it('starts with only the steps whose target exists, skips missing ones, and next past the end closes', () => {
  target('hub-search')
  target('pill')
  const { start } = useTourStore.getState()
  start('hub')
  expect(useTourStore.getState().steps).toEqual([])
  vi.advanceTimersByTime(1500)
  expect(useTourStore.getState().steps.map(step => step.target)).toEqual(['hub-search', 'pill'])
  expect(useTourStore.getState().index).toBe(0)
  useTourStore.getState().prev()
  expect(useTourStore.getState().index).toBe(0) // 첫 단계에서 이전은 그대로
  useTourStore.getState().next()
  expect(useTourStore.getState().index).toBe(1)
  useTourStore.getState().next()
  expect(useTourStore.getState().route).toBeNull()
  expect(useTourStore.getState().steps).toEqual([])
})

it('does not start when no target is on the page', () => {
  useTourStore.getState().start('sr')
  vi.advanceTimersByTime(1500)
  expect(useTourStore.getState().route).toBeNull()
  expect(useTourStore.getState().steps).toEqual([])
})

it('starts immediately when every target is already shown', () => {
  target('nav')
  target('pill')
  useTourStore.getState().start('other')
  expect(useTourStore.getState().route).toBe('other')
  expect(useTourStore.getState().steps.map(step => step.target)).toEqual(['nav', 'pill'])
  expect(vi.getTimerCount()).toBe(0)
})

it('waits for late conversation targets without exposing a pill-only tour, then skips the absent related panel', () => {
  target('pill')
  useTourStore.getState().start('conversation')
  vi.advanceTimersByTime(300)
  expect(useTourStore.getState().steps).toEqual([])
  target('composer')
  const tabs = target('task-tabs', 'none')
  vi.advanceTimersByTime(300)
  tabs.style.display = ''
  vi.advanceTimersByTime(899)
  expect(useTourStore.getState().steps).toEqual([])
  vi.advanceTimersByTime(1)
  expect(useTourStore.getState().steps.map(step => step.target)).toEqual(['composer', 'task-tabs', 'pill'])
  target('related')
  vi.advanceTimersByTime(100)
  expect(useTourStore.getState().steps).toHaveLength(3) // 확정 후 total은 그대로
})

it('starts on the next frame when all late targets appear, without waiting for the deadline', () => {
  useTourStore.getState().start('other')
  vi.advanceTimersByTime(200)
  target('nav')
  target('pill')
  vi.advanceTimersToNextFrame()
  expect(useTourStore.getState().steps.map(step => step.target)).toEqual(['nav', 'pill'])
  expect(vi.getTimerCount()).toBe(0)
})

it('closing cancels pending work and a later start cannot be overwritten by the old deadline', () => {
  target('pill')
  useTourStore.getState().start('conversation')
  vi.advanceTimersByTime(300)
  useTourStore.getState().close()
  expect(vi.getTimerCount()).toBe(0)
  target('composer')
  vi.advanceTimersByTime(1500)
  expect(useTourStore.getState().route).toBeNull()
  useTourStore.getState().start('conversation')
  vi.advanceTimersByTime(300)
  target('nav')
  useTourStore.getState().start('other')
  vi.advanceTimersByTime(1500)
  expect(useTourStore.getState().route).toBe('other')
  expect(useTourStore.getState().steps.map(step => step.target)).toEqual(['nav', 'pill'])
  expect(vi.getTimerCount()).toBe(0)
})
