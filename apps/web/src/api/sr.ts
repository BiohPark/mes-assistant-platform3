import type { Message, ServiceRequest, SharedResult } from '@mes/domain'
import type { FileMeta } from './files'
import { queryClient } from './queryClient'

export type SrDetail = ServiceRequest & { intakeMessages?: Message[]; firstMessage?: string; requesterName?: string; /** 상세 응답: 접수 대화에 요청 기록이 있어 초안을 삭제할 수 없음 */ hasRequests?: boolean; conversations: Array<{ id: string; code: string; title: string; status: string; threadId: string | null }> }
async function request<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
  const response = await fetch(`/api/service-requests${path}`, { method, credentials: 'same-origin',
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(key && { 'Idempotency-Key': key }) },
    ...(body !== undefined && { body: JSON.stringify(body) }) })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  if (method !== 'GET') void queryClient.invalidateQueries({ queryKey: ['sr'] })
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
const path = (id: string) => `/${encodeURIComponent(id)}`
export const listSr = (scope?: 'mine' | 'inbox') => request<SrDetail[]>(scope ? `?scope=${scope}` : '')
export const getSrIntakeAssistant = () => request<{ srIntakeAssistantId: string | null; name?: string; summary?: string; usageExample?: string; fileMaxPerRequest?: number }>('/intake-assistant')
export const getSr = (id: string) => request<SrDetail>(path(id))
export const createSr = (key?: string) => request<SrDetail>('', 'POST', undefined, key)
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
