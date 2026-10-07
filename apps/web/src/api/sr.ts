import type { ServiceRequest, SharedResult } from '@mes/domain'
import type { FileMeta } from './files'
import { queryClient } from './queryClient'

export type SrDetail = ServiceRequest & { conversations: Array<{ id: string; code: string; title: string; status: string; threadId: string | null }> }
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/service-requests${path}`, { method, credentials: 'same-origin',
    ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  if (method !== 'GET') void queryClient.invalidateQueries({ queryKey: ['sr'] })
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
const path = (id: string) => `/${encodeURIComponent(id)}`
export const listSr = () => request<SrDetail[]>('')
export const getSrIntakeAssistant = () => request<{ srIntakeAssistantId: string | null }>('/intake-assistant')
export const getSr = (id: string) => request<SrDetail>(path(id))
export const createSr = () => request<SrDetail>('', 'POST')
export const deleteSr = (id: string) => request<void>(path(id), 'DELETE')
export const draftSr = (id: string) => request<{ title: string; body: string }>(`${path(id)}/draft`)
export const submitSr = (id: string, input: { title: string; titleSource: 'ai' | 'manual'; body: string; attachmentIds: string[] }) => request<SrDetail>(`${path(id)}/submit`, 'POST', input)
export const titleSr = (id: string, title: string) => request<SrDetail>(`${path(id)}/title`, 'PATCH', { title })
export const contentSr = (id: string, input: { title: string; body: string; attachmentIds: string[]; titleSource?: 'ai' | 'manual' }) => request<SrDetail>(`${path(id)}/content`, 'PATCH', input)
export const statusSr = (id: string, status: string) => request<SrDetail>(`${path(id)}/status`, 'PATCH', { status })
export const startSrTask = (id: string, assistantId: string, forceNew = false) => request<{ id?: string; candidates?: SrDetail['conversations'] }>(`${path(id)}/tasks`, 'POST', { assistantId, forceNew })
export const shareSr = (id: string, input: { taskId?: string; text: string; fileIds: string[] }) => request<SharedResult>(`${path(id)}/results`, 'POST', input)
export const srResults = (id: string) => request<SharedResult[]>(`${path(id)}/results`)
export async function uploadSrFile(id: string, file: File): Promise<FileMeta> {
  const form = new FormData()
  form.set('file', file)
  const response = await fetch(`/api/service-requests${path(id)}/files`, { method: 'POST', credentials: 'same-origin', body: form })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  return response.json() as Promise<FileMeta>
}
