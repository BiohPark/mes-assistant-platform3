import { infiniteQueryOptions, queryOptions, useQuery } from '@tanstack/react-query'
import type { TaskSummary } from '@mes/domain'
import { getTaskBoard, listTaskPage, type TaskFilter } from './tasks'
import { selectMyActive } from '@/features/home/myActive'

// All list variants share the SSE/mutation invalidation prefix, never the detail key.
export const taskKeys = {
  page: (userId: string, filter: TaskFilter) => ['tasks', userId, 'summary', filter] as const,
  board: (userId: string, filter: TaskFilter) => ['tasks', userId, 'board', filter] as const,
}
export const taskPages = (userId: string, filter: TaskFilter) => infiniteQueryOptions({
  queryKey: [...taskKeys.page(userId, filter), 'infinite'] as readonly unknown[], initialPageParam: undefined as string | undefined,
  queryFn: ({ pageParam, signal }) => listTaskPage({ ...filter, cursor: pageParam }, signal),
  getNextPageParam: page => page.nextCursor ?? undefined,
})
export const taskBoard = (userId: string, filter: TaskFilter) => queryOptions({
  queryKey: taskKeys.board(userId, filter), queryFn: ({ signal }) => getTaskBoard(filter, signal),
})
export function uniqueTasks(pages: Array<{ items: TaskSummary[] }>): TaskSummary[] {
  const items = new Map<string, TaskSummary>()
  for (const page of pages) for (const task of page.items) if (!items.has(task.id)) items.set(task.id, task)
  return [...items.values()]
}
/** Fetch responding work independently so it is not lost beyond the recent page. */
export function useMyActive(userId: string, limit: number) {
  const filter: TaskFilter = { mine: true, status: ['in_progress'], limit }
  const recent = useQuery({ queryKey: taskKeys.page(userId, filter), queryFn: ({ signal }) => listTaskPage(filter, signal) })
  const aiFilter: TaskFilter = { ...filter, ai: ['responding'] }
  const responding = useQuery({ queryKey: taskKeys.page(userId, aiFilter), queryFn: ({ signal }) => listTaskPage(aiFilter, signal) })
  return { ...recent, isPending: recent.isPending || responding.isPending, isError: recent.isError || responding.isError,
    refetch: () => Promise.all([recent.refetch(), responding.refetch()]),
    items: selectMyActive(uniqueTasks([responding.data ?? { items: [] }, recent.data ?? { items: [] }]), userId, limit) }
}
