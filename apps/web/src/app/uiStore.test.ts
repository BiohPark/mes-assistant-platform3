import { expect, it } from 'vitest'
import { emptyHomeFilters, useUiStore } from './uiStore'

it('migrates v0 scalar filters to v1 arrays without losing other preferences', async () => {
  localStorage.setItem('mes-hub-ui', JSON.stringify({ version: 0, state: { homeFilters: { q: 'kept', level1CodeId: 'l1', level2CodeId: 'l2', showRetired: true }, kanbanCollapseEmpty: true } }))
  await useUiStore.persist.rehydrate()
  expect(useUiStore.getState().homeFilters).toEqual({ q: 'kept', level1CodeIds: ['l1'], level2CodeIds: ['l2'], showRetired: true })
  expect(useUiStore.getState().kanbanCollapseEmpty).toBe(true)
  expect(JSON.parse(localStorage.getItem('mes-hub-ui')!).version).toBe(1)
})
it('keeps multiple Lv2 choices when Lv1 changes until the catalog validates them', () => {
  useUiStore.setState({ homeFilters: emptyHomeFilters() })
  useUiStore.getState().setHomeFilters({ level1CodeIds: ['one'], level2CodeIds: ['a', 'b'] })
  useUiStore.getState().setHomeFilters({ level1CodeIds: ['two'] })
  expect(useUiStore.getState().homeFilters.level2CodeIds).toEqual(['a', 'b'])
})
