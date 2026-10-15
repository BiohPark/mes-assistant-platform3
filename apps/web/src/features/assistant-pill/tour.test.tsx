import { afterEach, expect, it } from 'vitest'
import { PAGE_ACTIONS } from './pageActions'
import { TOUR_STEPS, tourTarget, useTourStore } from './tour'

function target(id: string, display = '') {
  const element = document.createElement('div')
  element.dataset.tour = id
  element.style.display = display
  document.body.append(element)
  return element
}
afterEach(() => { useTourStore.getState().close(); document.querySelectorAll('[data-tour]').forEach(element => element.remove()) })

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
  expect(start('hub')).toBe(true)
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
  expect(useTourStore.getState().start('sr')).toBe(false)
  expect(useTourStore.getState().route).toBeNull()
})
