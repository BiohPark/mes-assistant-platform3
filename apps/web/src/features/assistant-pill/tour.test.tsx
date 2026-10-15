import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PAGE_ACTIONS } from './pageActions'
import { TOUR_SECTIONS, tourTarget, useTourStore } from './tour'
import { newId } from '@/lib/ids'
import { readTourProgress, tourProgressKey } from './tutorial'

function target(id: string, display = '') {
  const element = document.createElement('div')
  element.dataset.tour = id
  element.style.display = display
  document.body.append(element)
  return element
}
let userId = ''
const state = () => useTourStore.getState()
const sectionIds = () => state().sections.map(section => section.id)
const stepIds = () => state().sections.flatMap(section => section.steps.map(step => step.target))
const current = () => state().sections[state().sectionIndex]?.steps[state().stepIndex]?.target
/** 없는 대상이 있으면 1.5초 대기 뒤 확정된다 */
const begin = (route: Parameters<ReturnType<typeof useTourStore.getState>['start']>[0]) => { state().start(route, userId); vi.advanceTimersByTime(1500) }
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); userId = newId() }) // 모듈 메모리 폴백도 사용자별이라 ID를 새로 쓴다
afterEach(() => { state().close(); document.querySelectorAll('[data-tour]').forEach(element => element.remove()); vi.useRealTimers() })

it('every page has sections with unique ids and ends with the assistant section (the pill exists on every page)', () => {
  for (const route of Object.keys(PAGE_ACTIONS) as (keyof typeof PAGE_ACTIONS)[]) {
    const sections = TOUR_SECTIONS[route]
    expect(sections.length).toBeGreaterThan(0)
    expect(new Set(sections.map(section => section.id)).size).toBe(sections.length)
    expect(sections.at(-1)?.steps.at(-1)?.target).toBe('pill')
    for (const section of sections) expect(section.steps.length).toBeGreaterThan(0)
  }
})

it('conversation sections cover basics, materials, discussion, tags, brief and status; the kanban section lives on the hub route', () => {
  expect(TOUR_SECTIONS.conversation.map(section => section.id)).toEqual(['basics', 'materials', 'discussion', 'tags', 'brief', 'status', 'assistant'])
  expect(TOUR_SECTIONS.conversation[0]!.steps.map(step => step.target)).toEqual(['composer', 'model', 'chat-search', 'chat-toc', 'quick-switch', 'popout'])
  expect(TOUR_SECTIONS.conversation[1]!.steps.map(step => step.target)).toEqual(['task-tabs', 'materials-library', 'materials-staged'])
  expect(TOUR_SECTIONS.hub.find(section => section.id === 'kanban')?.steps.map(step => step.target)).toEqual(['kanban-filters', 'kanban-ai-filter', 'kanban-columns', 'kanban-card'])
})

it('a step that opens the materials panel counts as available while the panel tab exists, and is dropped with it', () => {
  target('composer'); target('pill')
  const tabs = target('task-tabs')
  begin('conversation') // 다른 대화 대상(요약 카드 등)이 없어 대기 뒤 확정
  expect(stepIds()).toEqual(['composer', 'task-tabs', 'materials-library', 'materials-staged', 'pill']) // 자료 패널은 아직 안 열렸지만 탭이 있다
  state().close(); tabs.remove()
  begin('conversation')
  expect(stepIds()).toEqual(['composer', 'pill'])
})

it('picks the first shown target — hidden duplicates (display:none, e.g. the other breakpoint tablist) are ignored', () => {
  const hidden = target('task-tabs', 'none')
  const shown = target('task-tabs')
  expect(tourTarget('task-tabs')).toBe(shown)
  hidden.remove(); shown.remove()
  expect(tourTarget('task-tabs')).toBeUndefined()
})

it('starts with only the steps whose target exists, drops empty sections, and next past the end closes', () => {
  target('hub-search')
  target('pill')
  state().start('hub', 'u')
  expect(state().sections).toEqual([])
  vi.advanceTimersByTime(1500)
  expect(sectionIds()).toEqual(['hub', 'assistant']) // 칸반·메뉴 섹션은 대상이 없어 빠진다
  expect(stepIds()).toEqual(['hub-search', 'pill'])
  expect(current()).toBe('hub-search')
  state().prev()
  expect(current()).toBe('hub-search') // 첫 단계에서 이전은 그대로
  state().next()
  expect(current()).toBe('pill')
  state().next()
  expect(state().route).toBeNull()
  expect(state().sections).toEqual([])
})

it('does not start when no target is on the page', () => {
  state().start('sr', 'u')
  vi.advanceTimersByTime(1500)
  expect(state().route).toBeNull()
  expect(state().sections).toEqual([])
})

it('starts immediately when every target is already shown', () => {
  target('nav')
  target('pill')
  state().start('other', 'u')
  expect(state().route).toBe('other')
  expect(stepIds()).toEqual(['nav', 'pill'])
  expect(vi.getTimerCount()).toBe(0)
})

it('waits for late conversation targets without exposing a pill-only tour, then skips the absent panels', () => {
  target('pill')
  state().start('conversation', 'u')
  vi.advanceTimersByTime(300)
  expect(state().sections).toEqual([])
  target('composer')
  const tabs = target('task-tabs', 'none')
  vi.advanceTimersByTime(300)
  tabs.style.display = ''
  vi.advanceTimersByTime(899)
  expect(state().sections).toEqual([])
  vi.advanceTimersByTime(1)
  expect(sectionIds()).toEqual(['basics', 'materials', 'assistant'])
  expect(stepIds()).toEqual(['composer', 'task-tabs', 'materials-library', 'materials-staged', 'pill']) // 자료 패널 단계는 탭이 있으면 센다(보일 때 탭을 연다)
  target('related')
  vi.advanceTimersByTime(100)
  expect(stepIds()).toHaveLength(5) // 확정 후 total은 그대로
})

it('starts on the next frame when all late targets appear, without waiting for the deadline', () => {
  state().start('other', 'u')
  vi.advanceTimersByTime(200)
  target('nav')
  target('pill')
  vi.advanceTimersToNextFrame()
  expect(stepIds()).toEqual(['nav', 'pill'])
  expect(vi.getTimerCount()).toBe(0)
})

it('closing cancels pending work and a later start cannot be overwritten by the old deadline', () => {
  target('pill')
  state().start('conversation', 'u')
  vi.advanceTimersByTime(300)
  state().close()
  expect(vi.getTimerCount()).toBe(0)
  target('composer')
  vi.advanceTimersByTime(1500)
  expect(state().route).toBeNull()
  state().start('conversation', 'u')
  vi.advanceTimersByTime(300)
  target('nav')
  state().start('other', 'u')
  vi.advanceTimersByTime(1500)
  expect(state().route).toBe('other')
  expect(stepIds()).toEqual(['nav', 'pill'])
  expect(vi.getTimerCount()).toBe(0)
})

it('moves across section boundaries in both directions and records a section as done when its last step is passed', () => {
  target('composer'); target('model'); target('discussion'); target('pill')
  begin('conversation')
  expect(sectionIds()).toEqual(['basics', 'discussion', 'assistant'])
  state().next()
  expect([state().sectionIndex, state().stepIndex]).toEqual([0, 1])
  state().next() // basics 끝 → 다음 섹션 첫 단계, basics 완료
  expect([state().sectionIndex, state().stepIndex]).toEqual([1, 0])
  expect(state().done).toEqual(['basics'])
  expect(readTourProgress(userId, 'conversation')).toEqual(['basics'])
  expect(JSON.parse(localStorage.getItem(tourProgressKey(userId, 'conversation'))!)).toEqual(['basics'])
  state().prev() // 뒤로는 이전 섹션의 마지막 단계
  expect([state().sectionIndex, state().stepIndex]).toEqual([0, 1])
  state().next(); state().next() // discussion 끝
  expect(state().done).toEqual(['basics', 'discussion'])
  state().next() // 마지막(pill) 지나면 닫히며 assistant도 완료
  expect(state().route).toBeNull()
  expect(readTourProgress(userId, 'conversation')).toEqual(['basics', 'discussion', 'assistant'])
  expect(readTourProgress('other-user', 'conversation')).toEqual([]) // 사용자별
})

it('skipSection jumps to the next section without marking the current one done; on the last section it closes; goToSection replays any section', () => {
  target('composer'); target('discussion'); target('pill')
  begin('conversation')
  state().skipSection()
  expect([state().sectionIndex, state().stepIndex]).toEqual([1, 0])
  expect(state().done).toEqual([])
  state().goToSection(0)
  expect([state().sectionIndex, state().stepIndex]).toEqual([0, 0])
  state().goToSection(2)
  expect(current()).toBe('pill')
  state().skipSection()
  expect(state().route).toBeNull()
  expect(readTourProgress(userId, 'conversation')).toEqual([])
})

it('resumes at the first section not yet done; when everything is done it starts from the beginning', () => {
  target('composer'); target('discussion'); target('pill')
  begin('conversation')
  state().next() // basics done → discussion
  state().close()
  begin('conversation')
  expect(state().done).toEqual(['basics'])
  expect(state().sectionIndex).toBe(1)
  state().next(); state().next() // discussion, assistant 완료 → 닫힘
  expect(readTourProgress(userId, 'conversation')).toEqual(['basics', 'discussion', 'assistant'])
  begin('conversation')
  expect(state().sectionIndex).toBe(0)
})
