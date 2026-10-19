import { saveInputSelection } from './inputSelection'
import type { MaterialCandidateCount } from '@mes/contracts'
import type { TaskInput } from '@mes/domain'
import { toast } from 'sonner'
import { HttpError } from '@/app/auth'
import type { Translator } from '@/i18n'
import type { Actor } from './tasks'
import { queryClient } from './queryClient'

export interface FileMeta {
  id: string
  originTaskId?: string
  /** SR 첨부면 그 SR — 업무가 아니라 SR에 속한 같은 file_object */
  originSrId?: string
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
  /** 출처 대화의 코드·제목 — 화면에는 내부 ID 대신 이것을 보여 준다 */
  sourceCode?: string
  sourceTitle?: string
  sourceAssistantId?: string
  viaTags: string[]
  role: 'output' | 'upload'
  selected?: TaskInput['weight']
  newerVersionId?: string
  olderVersionIds?: string[]
}
/** 연결 SR(SR에서 시작한 업무)의 접수 첨부 정본 — 복사본이 아니라 같은 파일 */
export interface SrFileCandidate { file: FileMeta; srId: string; srCode: string; srTitle: string; selected?: TaskInput['weight'] }
export interface ConversationCandidate { taskId: string; code: string; title: string; status: string; assistant: { id: string; name: string; color: string };
  sharedTags: string[]; messageCount: number; bytes: number; bytesFull?: number; bytesAnswer?: number; lastActivityAt: string; used?: boolean;
  selected?: { weight: 'main' | 'reference'; mode: 'full' | 'messages' | 'summary'; snapshotId: string; newMessages: number; detached: boolean } }
/** usedFileIds: 이 대화의 요청 기록에 실린 파일('쓴 적 있음') */
export interface Candidates { files: FileCandidate[]; srFiles?: SrFileCandidate[]; conversations: ConversationCandidate[]; usedFileIds?: string[] }

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
async function refresh(_taskId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['files'] }),
    queryClient.invalidateQueries({ queryKey: ['candidate-count'] }),
    queryClient.invalidateQueries({ queryKey: ['candidates'] }),
    queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    queryClient.invalidateQueries({ queryKey: ['task'] })
  ])
  await queryClient.invalidateQueries({ queryKey: ['estimate'], refetchType: 'none' })
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
  return saveInputSelection(taskId, async () => {
    await request(`/tasks/${encodeURIComponent(taskId)}/inputs/${encodeURIComponent(fileId)}`, weight ? 'PUT' : 'DELETE', weight ? { weight } : undefined)
    await refresh(taskId)
  })
}
export async function switchInputVersion(_actor: Actor, taskId: string, fromFileId: string, toFileId: string): Promise<void> {
  return saveInputSelection(taskId, async () => {
    await request(`/tasks/${encodeURIComponent(taskId)}/inputs/${encodeURIComponent(fromFileId)}/switch-version`, 'POST', { toFileId })
    await refresh(taskId)
  })
}
/** 다운로드 피드백은 여기 한 곳 — 목록·미리보기·버전 기록이 모두 이 함수를 부른다 */
export async function downloadBlob(file: FileMeta, t: Translator): Promise<void> {
  try {
    const response = await fetch(`/api/files/${encodeURIComponent(file.id)}/content`, { credentials: 'same-origin' })
    if (!response.ok) throw new HttpError(response.status)
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    const status = error instanceof HttpError ? error.status : undefined
    toast.error(status === 401 ? t('task.files.downloadUnauthorized')
      : status === 403 ? t('task.files.downloadForbidden')
      : status === 404 || status === 410 ? t('task.files.downloadMissing')
      : t('task.files.downloadFailed', { reason: error instanceof Error ? error.message : String(error) }))
  }
}
export function isTextFile(file: Pick<FileMeta, 'name' | 'mime'>): boolean {
  return /^(text\/|application\/(json|xml|x-yaml))/.test(file.mime) || /\.(md|txt|csv|json|sql|xml|ya?ml)$/i.test(file.name)
}
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const getCandidateCount = (taskId: string) => request<MaterialCandidateCount>(`/tasks/${encodeURIComponent(taskId)}/candidate-count`)
