import type { ActivityLog, Message, Task, TaskStatus, Thread } from '@mes/domain'
import type { TagSuggestion } from '@mes/domain'
import { queryClient } from './queryClient'

export interface Actor { userId: string }
export interface StartConversationInput { assistantId: string; tags?: string[]; title?: string; referenceTaskId?: string; inputFileIds?: string[]; firstMessage?: string }
export interface TaskFilter { assistantId?: string; status?: TaskStatus[]; tags?: string[]; mine?: boolean }

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

function refresh(taskId?: string) {
  void queryClient.invalidateQueries({ queryKey: ['tasks'] })
  void queryClient.invalidateQueries({ queryKey: ['assistant-stats'] })
  void queryClient.invalidateQueries({ queryKey: ['tag-suggest'] })
  void queryClient.invalidateQueries({ queryKey: ['activity'] })
  if (taskId) {
    void queryClient.invalidateQueries({ queryKey: ['task', taskId] })
    void queryClient.invalidateQueries({ queryKey: ['activity', taskId] })
  }
}

export async function startConversation(_actor: Actor, input: StartConversationInput): Promise<{ task: Task; thread: Thread }> {
  const task = await request<Task>('/tasks', 'POST', input)
  refresh(task.id)
  return { task, thread: { id: task.threadId!, taskId: task.id, title: '대화', createdAt: task.createdAt, createdBy: task.createdBy, archived: false } }
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
export const getMessages = (threadId: string) => request<Message[]>(`/threads/${encodeURIComponent(threadId)}/messages`)
export const getActivity = (taskId: string) => request<ActivityLog[]>(`/tasks/${encodeURIComponent(taskId)}/activity`)
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
