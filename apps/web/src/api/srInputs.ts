import { saveInputSelection } from './inputSelection'
import type { TaskSrInput } from '@mes/contracts'
import { queryClient } from './queryClient'

export type { TaskSrInput } from '@mes/contracts'
const path = (taskId: string, srId?: string) => `/api/tasks/${encodeURIComponent(taskId)}/sr-inputs${srId ? `/${encodeURIComponent(srId)}` : ''}`
async function request<T>(url: string, method = 'GET'): Promise<T> {
  const response = await fetch(url, { method, credentials: 'same-origin' })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
async function refresh(taskId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['sr-inputs', taskId] }),
    queryClient.invalidateQueries({ queryKey: ['task', taskId] })
  ])
  await queryClient.invalidateQueries({ queryKey: ['estimate'], refetchType: 'none' })
}
export const listSrInputs = (taskId: string) => request<TaskSrInput[]>(path(taskId))
export async function selectSrInput(taskId: string, srId: string) {
  return saveInputSelection(taskId, async () => {
    await request(path(taskId, srId), 'PUT'); await refresh(taskId)
  })
}
export async function removeSrInput(taskId: string, srId: string) {
  return saveInputSelection(taskId, async () => {
    await request(path(taskId, srId), 'DELETE'); await refresh(taskId)
  })
}
