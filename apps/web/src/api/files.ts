import type { TaskInput } from '@mes/domain'
import type { Actor } from './tasks'
import { queryClient } from './queryClient'

export interface FileMeta {
  id: string
  originTaskId?: string
  name: string
  mime: string
  size: number
  sha256: string
  source: 'upload' | 'assistant'
  isOutput: boolean
  version: number
  previousId?: string
  uploadedBy: string
  uploadedAt: string
}
export interface FileCandidate {
  file: FileMeta
  sourceTaskId: string
  viaTags: string[]
  role: 'output' | 'upload'
  selected?: TaskInput['weight']
  newerVersionId?: string
  olderVersionIds?: string[]
}
export interface ConversationCandidate { taskId: string; code: string; title: string; status: string; assistant: { id: string; name: string; color: string };
  sharedTags: string[]; messageCount: number; bytes: number; lastActivityAt: string;
  selected?: { weight: 'main' | 'reference'; mode: 'full' | 'messages' | 'summary'; snapshotId: string; newMessages: number; detached: boolean } }
export interface Candidates { files: FileCandidate[]; conversations: ConversationCandidate[] }

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
function refresh(taskId?: string) {
  void queryClient.invalidateQueries({ queryKey: ['files'] })
  void queryClient.invalidateQueries({ queryKey: ['candidates'] })
  void queryClient.invalidateQueries({ queryKey: ['tasks'] })
  void queryClient.invalidateQueries({ queryKey: ['task'] })
  void queryClient.invalidateQueries({ queryKey: ['estimate'] })
  if (taskId) void queryClient.invalidateQueries({ queryKey: ['task', taskId] })
}

export async function uploadFile(_actor: Actor, origin: { taskId: string }, file: File): Promise<FileMeta> {
  const body = new FormData()
  body.set('originTaskId', origin.taskId)
  body.set('file', file)
  const response = await fetch('/api/files', { method: 'POST', credentials: 'same-origin', body })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  const result = await response.json() as FileMeta
  refresh(origin.taskId)
  return result
}
export async function saveAssistantOutput(_actor: Actor, taskId: string, name: string, content: string): Promise<FileMeta> {
  const result = await request<FileMeta>(`/tasks/${encodeURIComponent(taskId)}/outputs`, 'POST', { name, content })
  refresh(taskId)
  return result
}
export async function setOutputTag(_actor: Actor, _taskId: string, fileId: string, isOutput: boolean): Promise<void> {
  await request(`/files/${encodeURIComponent(fileId)}`, 'PATCH', { isOutput })
  refresh(_taskId)
}
export async function deleteFile(fileId: string): Promise<{ ok: boolean; reason?: string }> {
  try { await request(`/files/${encodeURIComponent(fileId)}`, 'DELETE'); refresh(); return { ok: true } }
  catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
}
export const fileVersions = (fileId: string) => request<FileMeta[]>(`/files/${encodeURIComponent(fileId)}/versions`)
export const filesForTask = (taskId: string) => request<FileMeta[]>(`/tasks/${encodeURIComponent(taskId)}/files`)
export const getCandidates = (taskId: string) => request<Candidates>(`/tasks/${encodeURIComponent(taskId)}/candidates`)
export async function setInput(_actor: Actor, taskId: string, fileId: string, weight: TaskInput['weight'] | null): Promise<void> {
  await request(`/tasks/${encodeURIComponent(taskId)}/inputs/${encodeURIComponent(fileId)}`, weight ? 'PUT' : 'DELETE', weight ? { weight } : undefined)
  refresh(taskId)
}
export async function switchInputVersion(_actor: Actor, taskId: string, fromFileId: string, toFileId: string): Promise<void> {
  await request(`/tasks/${encodeURIComponent(taskId)}/inputs/${encodeURIComponent(fromFileId)}/switch-version`, 'POST', { toFileId })
  refresh(taskId)
}
export async function downloadBlob(file: FileMeta): Promise<void> {
  const response = await fetch(`/api/files/${encodeURIComponent(file.id)}/content`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function isTextFile(file: Pick<FileMeta, 'name' | 'mime'>): boolean {
  return /^(text\/|application\/(json|xml|x-yaml))/.test(file.mime) || /\.(md|txt|csv|json|sql|xml|ya?ml)$/i.test(file.name)
}
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
