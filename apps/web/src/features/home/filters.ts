import type { Assistant } from '@mes/contracts'
import type { HomeFilters } from '@/app/uiStore'

export function homeFiltersFromParams(params: URLSearchParams): HomeFilters {
  return { q: params.get('aq') ?? '', level1CodeIds: [...new Set(params.getAll('l1'))], level2CodeIds: [...new Set(params.getAll('l2'))], showRetired: params.get('retired') === '1' }
}
export function homeFiltersToParams(filters: HomeFilters, base: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base)
  for (const key of ['aq', 'l1', 'l2', 'retired']) next.delete(key)
  if (filters.q) next.set('aq', filters.q)
  filters.level1CodeIds.forEach(id => next.append('l1', id))
  filters.level2CodeIds.forEach(id => next.append('l2', id))
  if (filters.showRetired) next.set('retired', '1')
  return next
}
export function classificationOptions(assistants: Assistant[], level1Ids: string[]) {
  const paths = assistants.flatMap(assistant => assistant.classifications ?? [assistant])
  return {
    level1: [...new Map(paths.map(path => [path.level1CodeId, { id: path.level1CodeId, label: path.level1 }])).values()],
    level2: [...new Map(paths.filter(path => !level1Ids.length || level1Ids.includes(path.level1CodeId)).map(path => [path.level2CodeId, { id: path.level2CodeId, label: path.level2 }])).values()],
  }
}
export function validHomeFilters(filters: HomeFilters, assistants: Assistant[]): HomeFilters {
  const all = classificationOptions(assistants, [])
  const level1CodeIds = filters.level1CodeIds.filter(id => all.level1.some(option => option.id === id))
  return { ...filters, level1CodeIds, level2CodeIds: filters.level2CodeIds.filter(id => all.level2.some(option => option.id === id)) }
}
export function matchesAssistant(assistant: Assistant, filters: HomeFilters): boolean {
  if (!filters.showRetired && assistant.status === 'retired') return false
  const paths = assistant.classifications ?? [assistant]
  if (!paths.some(path => (!filters.level1CodeIds.length || filters.level1CodeIds.includes(path.level1CodeId)) && (!filters.level2CodeIds.length || filters.level2CodeIds.includes(path.level2CodeId)))) return false
  return `${assistant.name} ${assistant.summary} ${paths.map(path => `${path.level1} ${path.level2}`).join(' ')}`.toLowerCase().includes(filters.q.trim().toLowerCase())
}
