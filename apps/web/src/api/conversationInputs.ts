import type { ContextSnapshot, ConversationInput } from '@mes/domain'
import { queryClient } from './queryClient'

export interface LoadedConversationInput {
  input: ConversationInput
  snapshot: ContextSnapshot
  source: { taskId: string; code: string; title: string; assistant: { id: string; name: string; color: string } }
  messageCount: number
  newMessages: number
  detached: boolean
  bytes: number
}
export interface SelectConversation { mode: 'full' | 'messages' | 'summary'; weight?: 'main' | 'reference'; messageIds?: string[];
  summary?: { text: string; source: 'ai' | 'rule'; model?: string; messageIds: string[] } }
const path = (taskId: string, sourceTaskId?: string) => `/api/tasks/${encodeURIComponent(taskId)}/conversation-inputs${sourceTaskId ? `/${encodeURIComponent(sourceTaskId)}` : ''}`
async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, credentials: 'same-origin', ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
function refresh(taskId: string) {
  void queryClient.invalidateQueries({ queryKey: ['conversation-inputs', taskId] })
  void queryClient.invalidateQueries({ queryKey: ['candidates', taskId] })
  void queryClient.invalidateQueries({ queryKey: ['task', taskId] })
  void queryClient.invalidateQueries({ queryKey: ['estimate'] })
}
export const listConversationInputs = (taskId: string) => request<LoadedConversationInput[]>(path(taskId))
export async function selectConversation(taskId: string, sourceTaskId: string, body: SelectConversation) {
  const result = await request<LoadedConversationInput>(path(taskId, sourceTaskId), 'PUT', body); refresh(taskId); return result
}
export async function setConversationWeight(taskId: string, sourceTaskId: string, weight: 'main' | 'reference') {
  await request(path(taskId, sourceTaskId), 'PATCH', { weight }); refresh(taskId)
}
export async function removeConversationInput(taskId: string, sourceTaskId: string) {
  await request(path(taskId, sourceTaskId), 'DELETE'); refresh(taskId)
}
export async function refreshConversationInput(taskId: string, sourceTaskId: string) {
  const result = await request<LoadedConversationInput>(`${path(taskId, sourceTaskId)}/refresh`, 'POST'); refresh(taskId); return result
}
export const draftConversationSummary = (taskId: string, sourceTaskId: string, messageIds?: string[]) =>
  request<{ text: string; source: 'ai' | 'rule'; model?: string }>(`${path(taskId, sourceTaskId)}/summary-draft`, 'POST', { messageIds })
