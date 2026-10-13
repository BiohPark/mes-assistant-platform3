import { expect, it } from 'vitest'
import type { Assistant } from '@mes/contracts'
import type { Task, TaskAiRequestStatus } from '@mes/domain'
import { EMPTY_FILTER, filterFromParams, filterToParams } from '@mes/domain'
import { emptyHomeFilters } from '@/app/uiStore'
import { aiFilterFromParams, aiFilterToParams, homeFiltersFromParams, homeFiltersToParams, matchesAiFilter, matchesAssistant, classificationOptions, sameParams, validHomeFilters } from './filters'

const paths = [
  { level1: 'One', level2: 'Alpha', level1CodeId: 'l1', level2CodeId: 's1' },
  { level1: 'Two', level2: 'Beta', level1CodeId: 'l2', level2CodeId: 's2' },
]
const assistant = { ...paths[0], classifications: paths, name: 'Agent', summary: '', status: 'open' } as Assistant
it('matches both selected levels within the same path and searches secondary paths', () => {
  expect(matchesAssistant(assistant, { ...emptyHomeFilters(), level1CodeIds: ['l1'], level2CodeIds: ['s2'] })).toBe(false)
  expect(matchesAssistant(assistant, { ...emptyHomeFilters(), level1CodeIds: ['l2'], level2CodeIds: ['s1', 's2'] })).toBe(true)
  expect(matchesAssistant(assistant, { ...emptyHomeFilters(), q: 'Beta' })).toBe(true)
})
it('roundtrips multiple code IDs and preserves kanban and unrelated URL parameters', () => {
  const filters = { q: ' a / b ', level1CodeIds: ['code / 한', 'two'], level2CodeIds: ['sub'], showRetired: true }
  const params = homeFiltersToParams(filters, new URLSearchParams('view=kanban&tag=keep'))
  expect(homeFiltersFromParams(params)).toEqual(filters)
  expect(params.get('tag')).toBe('keep')
  expect(params.get('view')).toBe('kanban')
  expect(homeFiltersToParams(emptyHomeFilters(), params).has('l1')).toBe(false)
})
it('offers all Lv2 paths without Lv1 selection and removes invalid IDs only using loaded data', () => {
  expect(classificationOptions([assistant], []).level2.map(p => p.id)).toEqual(['s1', 's2'])
  expect(classificationOptions([assistant], ['l2']).level2.map(p => p.id)).toEqual(['s2'])
  expect(validHomeFilters({ ...emptyHomeFilters(), level1CodeIds: ['l2', 'gone'], level2CodeIds: ['s1', 's2'] }, [assistant])).toMatchObject({ level1CodeIds: ['l2'], level2CodeIds: ['s1', 's2'] })
})

it('keeps card and conversation searches independent in both serialization directions', () => {
  const params = homeFiltersToParams({ ...emptyHomeFilters(), q: 'agent' }, new URLSearchParams('q=conversation&tag=keep'))
  expect(params.get('aq')).toBe('agent')
  expect(filterFromParams(params).q).toBe('conversation')
  const next = filterToParams({ ...EMPTY_FILTER, q: 'changed' }, params)
  expect(homeFiltersFromParams(next).q).toBe('agent')
  expect(homeFiltersToParams(emptyHomeFilters(), next).get('q')).toBe('changed')
  expect(homeFiltersFromParams(new URLSearchParams('q=conversation')).q).toBe('')
})

it('treats reordered parameters as the same URL and detects content differences', () => {
  expect(sameParams(new URLSearchParams('l1=one&view=kanban'), new URLSearchParams('view=kanban&l1=one'))).toBe(true)
  expect(sameParams(new URLSearchParams('l1=one&l1=one'), new URLSearchParams('l1=one'))).toBe(false)
  expect(sameParams(new URLSearchParams('aq='), new URLSearchParams(''))).toBe(false)
})

it('reads AI filter values from the URL, drops unknown or repeated ones and writes them back beside other parameters', () => {
  const params = new URLSearchParams('view=kanban&ai=responding&ai=bogus&ai=responding&tag=keep')
  expect(aiFilterFromParams(params)).toEqual(['responding'])
  const next = aiFilterToParams(['failed'], params)
  expect(next.getAll('ai')).toEqual(['failed'])
  expect(next.get('tag')).toBe('keep')
  expect(next.get('view')).toBe('kanban')
  expect(aiFilterToParams([], next).has('ai')).toBe(false)
  expect(sameParams(aiFilterToParams(['responding', 'failed'], new URLSearchParams('tag=a')), new URLSearchParams('ai=failed&tag=a&ai=responding'))).toBe(true)
})
it('matches responding (pending·streaming) and failed (failed·interrupted) AI states; no selection matches everything', () => {
  const withAi = (status: TaskAiRequestStatus | null) => ({ aiRequest: status ? { status, updatedAt: '2026-10-13T00:00:00.000Z' } : null }) as Task
  expect(matchesAiFilter(withAi(null), [])).toBe(true)
  expect(matchesAiFilter(withAi('pending'), ['responding'])).toBe(true)
  expect(matchesAiFilter(withAi('streaming'), ['responding'])).toBe(true)
  expect(matchesAiFilter(withAi('failed'), ['responding'])).toBe(false)
  expect(matchesAiFilter(withAi(null), ['responding'])).toBe(false)
  expect(matchesAiFilter(withAi('failed'), ['failed'])).toBe(true)
  expect(matchesAiFilter(withAi('interrupted'), ['failed'])).toBe(true)
  expect(matchesAiFilter(withAi('streaming'), ['failed'])).toBe(false)
  expect(matchesAiFilter(withAi('streaming'), ['responding', 'failed'])).toBe(true)
  expect(matchesAiFilter({ aiRequest: undefined } as Task, ['failed'])).toBe(false)
})
