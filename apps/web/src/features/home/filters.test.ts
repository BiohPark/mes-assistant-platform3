import { expect, it } from 'vitest'
import type { Assistant } from '@mes/contracts'
import { emptyHomeFilters } from '@/app/uiStore'
import { homeFiltersFromParams, homeFiltersToParams, matchesAssistant, classificationOptions, validHomeFilters } from './filters'

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
