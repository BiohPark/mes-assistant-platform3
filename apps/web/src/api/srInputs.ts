import type { TaskSrInput } from '@mes/contracts'
import { queryClient } from './queryClient'

export type { TaskSrInput } from '@mes/contracts'
const path = (taskId: string, srId?: string) => `/api/tasks/${encodeURIComponent(taskId)}/sr-inputs${srId ? `/${encodeURIComponent(srId)}` : ''}`
async function request<T>(url: string, method = 'GET'): Promise<T> {
  const response = await fetch(url, { method, credentials: 'same-origin' })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
function refresh(taskId: string) {
  void queryClient.invalidateQueries({ queryKey: ['sr-inputs', taskId] })
  void queryClient.invalidateQueries({ queryKey: ['task', taskId] })
  void queryClient.invalidateQueries({ queryKey: ['estimate'] })
}
export const listSrInputs = (taskId: string) => request<TaskSrInput[]>(path(taskId))
export async function selectSrInput(taskId: string, srId: string) {
  await request(path(taskId, srId), 'PUT'); refresh(taskId)
}
export async function removeSrInput(taskId: string, srId: string) {
  await request(path(taskId, srId), 'DELETE'); refresh(taskId)
}
