import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { Task, TaskSummary, TaskPage, TaskBoard } from '@mes/domain'

type ListedTask = Task | TaskSummary
export type TaskListCache = ListedTask[] | TaskPage | TaskBoard | InfiniteData<TaskPage>

export function patchTaskPhase(data: TaskListCache | undefined, taskId: string, status: string, phase?: string): TaskListCache | undefined {
  if (!data) return data
  const patch = <T extends ListedTask>(items: T[]): T[] => items.map(task => task.id === taskId && task.aiRequest?.status === status
    ? { ...task, aiRequest: { ...task.aiRequest, phase } } : task)
  if (Array.isArray(data)) return patch(data)
  if ('pages' in data) return { ...data, pages: data.pages.map(page => ({ ...page, items: patch(page.items) })) }
  if ('columns' in data) return { ...data, columns: data.columns.map(column => ({ ...column, items: patch(column.items) })) }
  return { ...data, items: patch(data.items) }
}
/** Event refresh starts at the newest cursor; old continuation pages must not fan out. */
export function resetTaskPages(client: QueryClient) {
  for (const query of client.getQueryCache().findAll({ queryKey: ['tasks'] })) {
    const data = query.state.data as TaskListCache | undefined
    if (data && !Array.isArray(data) && 'pages' in data && data.pages.length > 1) {
      client.setQueryData(query.queryKey, { ...data, pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) })
    }
  }
}
