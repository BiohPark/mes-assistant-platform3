import type { ActivityLog, ChecklistItem, ChecklistReview, Message, Note, Task, TaskStatus, Thread } from '@mes/domain'
import type { TagSuggestion } from '@mes/domain'
import { queryClient } from './queryClient'

export interface Actor { userId: string }
export interface StartConversationInput { assistantId: string; ownerId?: string; assigneeIds?: string[]; tags?: string[]; title?: string; referenceTaskId?: string; inputFileIds?: string[]; firstMessage?: string }
export interface TaskFilter { assistantId?: string; status?: TaskStatus[]; tags?: string[]; mine?: boolean }

async function request<T>(path: string, method = 'GET', body?: unknown, idempotencyKey?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', signal, ...(body !== undefined && { headers: { 'content-type': 'application/json', ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }) }, body: JSON.stringify(body) }) })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

function refresh(taskId?: string) {
  void queryClient.invalidateQueries({ queryKey: ['tasks'] })
  void queryClient.invalidateQueries({ queryKey: ['assistant-stats'] })
  void queryClient.invalidateQueries({ queryKey: ['tag-suggest'] })
  void queryClient.invalidateQueries({ queryKey: ['activity'] })
  void queryClient.invalidateQueries({ queryKey: ['estimate'] })
  void queryClient.invalidateQueries({ queryKey: ['notes'] })
  if (taskId) {
    void queryClient.invalidateQueries({ queryKey: ['task', taskId] })
    void queryClient.invalidateQueries({ queryKey: ['activity', taskId] })
  }
}

export async function startConversation(_actor: Actor, input: StartConversationInput, idempotencyKey?: string): Promise<{ task: Task; thread: Thread; warnings: string[] }> {
  const task = await request<Task & { warnings?: string[] }>('/tasks', 'POST', input, idempotencyKey)
  refresh(task.id)
  return { task, thread: { id: task.threadId!, taskId: task.id, title: '대화', createdAt: task.createdAt, createdBy: task.createdBy, archived: false }, warnings: task.warnings ?? [] }
}

export async function listTasks(filter: TaskFilter = {}): Promise<Task[]> {
  const query = new URLSearchParams()
  if (filter.assistantId) query.set('assistantId', filter.assistantId)
  for (const status of filter.status ?? []) query.append('status[]', status)
  for (const tag of filter.tags ?? []) query.append('tag[]', tag)
  if (filter.mine) query.set('mine', 'true')
  return request(`/tasks${query.size ? `?${query}` : ''}`)
}
export const getTask = (taskId: string) => request<Task>(`/tasks/${encodeURIComponent(taskId)}`)
export const getMessages = (threadId: string, signal?: AbortSignal) => request<Message[]>(`/threads/${encodeURIComponent(threadId)}/messages`, 'GET', undefined, undefined, signal)
export const getActivity = (taskId: string) => request<ActivityLog[]>(`/tasks/${encodeURIComponent(taskId)}/activity`)
export const getChecklist = (taskId: string) => request<ChecklistItem[]>(`/tasks/${encodeURIComponent(taskId)}/checklist`)
export async function addChecklistItem(taskId: string, label: string): Promise<ChecklistItem[]> {
  const result = await request<ChecklistItem[]>(`/tasks/${encodeURIComponent(taskId)}/checklist`, 'POST', { label })
  refresh(taskId)
  return result
}
export async function toggleChecklist(taskId: string, itemId: string): Promise<ChecklistItem[]> {
  const result = await request<ChecklistItem[]>(`/tasks/${encodeURIComponent(taskId)}/checklist/${encodeURIComponent(itemId)}`, 'PATCH')
  refresh(taskId)
  return result
}
export async function removeChecklistItem(taskId: string, itemId: string): Promise<void> {
  await request(`/tasks/${encodeURIComponent(taskId)}/checklist/${encodeURIComponent(itemId)}`, 'DELETE')
  refresh(taskId)
}
export async function reviewChecklist(taskId: string): Promise<ChecklistReview> {
  const result = await request<ChecklistReview>(`/tasks/${encodeURIComponent(taskId)}/checklist/review`, 'POST')
  refresh(taskId)
  return result
}
export async function applyChecklistReview(taskId: string): Promise<{ applied: number }> {
  const result = await request<{ applied: number }>(`/tasks/${encodeURIComponent(taskId)}/checklist/review/apply`, 'POST')
  refresh(taskId)
  return result
}
export const getNotes = (taskId: string) => request<Note[]>(`/tasks/${encodeURIComponent(taskId)}/notes`)
export async function addNote(taskId: string, content: string, attachmentIds: string[] = []): Promise<Note> {
  const result = await request<Note>(`/tasks/${encodeURIComponent(taskId)}/notes`, 'POST', { content, attachmentIds })
  refresh(taskId)
  return result
}
export async function deleteNote(taskId: string, noteId: string): Promise<void> {
  await request(`/tasks/${encodeURIComponent(taskId)}/notes/${encodeURIComponent(noteId)}`, 'DELETE')
  refresh(taskId)
}
export interface CompletionFeedback { rating: number; comment: string }
export const previewTaskReport = (taskId: string, feedback?: CompletionFeedback, reason?: string) => request<{ content: string }>(`/tasks/${encodeURIComponent(taskId)}/complete/preview`, 'POST', { ...(feedback && { feedback }), ...(reason && { reason }) })
/** 완료. 필수 체크 항목이 미완료면 서버가 reason을 요구한다(400). */
export async function completeTask(taskId: string, feedback?: CompletionFeedback, reason?: string): Promise<Task> {
  const result = await request<Task>(`/tasks/${encodeURIComponent(taskId)}/complete`, 'POST', { ...(feedback && { feedback }), ...(reason && { reason }) })
  refresh(taskId)
  void queryClient.invalidateQueries({ queryKey: ['files', taskId] })
  return result
}
export const suggestTags = (prefix = '', exclude: string[] = []) => {
  const query = new URLSearchParams({ prefix })
  for (const tag of exclude) query.append('exclude[]', tag)
  return request<TagSuggestion[]>(`/tags/suggest?${query}`)
}

export async function setTaskTitle(taskId: string, title: string, source: Task['titleSource']): Promise<void> {
  if (source !== 'manual') throw new Error('AI 제목은 S3에서 지원합니다')
  await request(`/tasks/${encodeURIComponent(taskId)}`, 'PATCH', { title })
  refresh(taskId)
}
export async function updateTask(taskId: string, patch: Partial<Pick<Task, 'summary' | 'priority' | 'dueDate' | 'assigneeIds' | 'ownerId' | 'modelId'>>): Promise<void> {
  await request(`/tasks/${encodeURIComponent(taskId)}`, 'PATCH', patch)
  refresh(taskId)
}
export async function setTaskModel(_actor: Actor, taskId: string, modelId: string): Promise<void> {
  await updateTask(taskId, { modelId })
}
export async function addTag(_actor: Actor, taskId: string, tag: string): Promise<boolean> {
  await request(`/tasks/${encodeURIComponent(taskId)}/tags/${encodeURIComponent(tag)}`, 'PUT')
  refresh(taskId)
  return true
}
export async function removeTag(_actor: Actor, taskId: string, tag: string): Promise<void> {
  await request(`/tasks/${encodeURIComponent(taskId)}/tags/${encodeURIComponent(tag)}`, 'DELETE')
  refresh(taskId)
}
export async function setTaskStatus(_actor: Actor, taskId: string, status: TaskStatus, payload: Record<string, unknown> = {}): Promise<void> {
  await request(`/tasks/${encodeURIComponent(taskId)}/status`, 'POST', { status, ...payload })
  refresh(taskId)
}
export async function deleteTask(taskId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    await request(`/tasks/${encodeURIComponent(taskId)}`, 'DELETE')
    refresh(taskId)
    return { ok: true }
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
}
export async function appendMessage(_actor: Actor | null, threadId: string, role: Message['role'], content: string, attachmentIds: string[] = [], status: Message['status'] = 'done', kind?: Message['kind']): Promise<Message> {
  if (role !== 'user' || status !== 'done' || kind !== 'discussion') throw new Error('AI 요청은 후속 단계에서 지원합니다')
  const result = await request<Message>(`/threads/${encodeURIComponent(threadId)}/messages`, 'POST', { content, kind, ...(attachmentIds.length && { attachmentIds }) })
  void queryClient.invalidateQueries({ queryKey: ['messages', threadId] })
  refresh()
  return result
}
