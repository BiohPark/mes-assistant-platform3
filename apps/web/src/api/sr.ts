import type { Message, ServiceRequest, SharedResult, SrStatusChange } from '@mes/domain'
import type { FileMeta } from './files'
import { queryClient } from './queryClient'
import { readSse } from './requests'

export type SrDetail = ServiceRequest & { taskCount?: number; elapsedDays?: number; /** 첨부 후보: 이 SR에 올라간 파일 전체. 정본(attachmentIds)은 전환·수정에서 사람이 고른 것만 */ candidateAttachmentIds: string[]; intakeMessages?: Message[]; firstMessage?: string; requesterName?: string; /** 상세 응답: 접수 대화에 요청 기록이 있어 초안을 삭제할 수 없음 */ hasRequests?: boolean; /** 상세 응답: 상태 이력(activity_log sr.status_changed) */ statusHistory?: SrStatusChange[]; conversations: Array<{ id: string; code: string; title: string; status: string; threadId: string | null; ownerId?: string; assigneeIds?: string[] }> }
export class SrApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

async function request<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
  const response = await fetch(`/api/service-requests${path}`, { method, credentials: 'same-origin',
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(key && { 'Idempotency-Key': key }) },
    ...(body !== undefined && { body: JSON.stringify(body) }) })
  if (!response.ok) throw new SrApiError(response.status, (await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  if (method !== 'GET') void queryClient.invalidateQueries({ queryKey: ['sr'] })
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
const path = (id: string) => `/${encodeURIComponent(id)}`
export const listSr = (scope?: 'mine' | 'inbox') => request<SrDetail[]>(scope ? `?scope=${scope}` : '')
export const getSrIntakeAssistant = () => request<{ srIntakeAssistantId: string | null; name?: string; summary?: string; usageExample?: string; /** 접수 에이전트 모델이 만든 추천 첫 질문(현재 기준으로 만든 것만) */ suggestedQuestions?: string[]; fileMaxPerRequest?: number }>('/intake-assistant')
export const getSr = (id: string) => request<SrDetail>(path(id))
export const createSr = (key?: string) => request<SrDetail>('', 'POST', undefined, key)
export const deleteSr = (id: string) => request<void>(path(id), 'DELETE')
export const draftSr = (id: string) => request<{ title: string; body: string }>(`${path(id)}/draft`)
export const submitSr = (id: string, input: { title: string; titleSource: 'ai' | 'manual'; body: string; attachmentIds: string[]; updatedAt?: string }) => request<SrDetail>(`${path(id)}/submit`, 'POST', input)
export const titleSr = (id: string, title: string) => request<SrDetail>(`${path(id)}/title`, 'PATCH', { title })
export const contentSr = (id: string, input: { title: string; body: string; attachmentIds: string[]; titleSource?: 'ai' | 'manual'; updatedAt?: string }) => request<SrDetail>(`${path(id)}/content`, 'PATCH', input)
export const statusSr = (id: string, status: string, reason?: string) => request<SrDetail>(`${path(id)}/status`, 'PATCH', { status, ...(reason && { reason }) })
/** AI 제안(자동작성·다듬기) — source가 rule이면 AI 응답을 못 받아 규칙으로 정리한 것. suggestions는 본문에 넣지 않은 추천 목록. */
export interface SrProposal { title: string; body: string; suggestions: string[]; source: 'ai' | 'rule'; model?: string }
/** 제안을 SSE로 받는다(started·delta·completed/failed — 달성도 점검과 같은 패턴). 저장 없음, 적용은 사람이 한다. */
async function proposal(url: string, body: unknown, onDelta: (text: string) => void, signal?: AbortSignal): Promise<SrProposal> {
  const response = await fetch(`/api/service-requests${url}`, { method: 'POST', credentials: 'same-origin', signal,
    headers: { Accept: 'text/event-stream', ...(body !== undefined && { 'content-type': 'application/json' }) }, ...(body !== undefined && { body: JSON.stringify(body) }) })
  if (!response.ok) throw new SrApiError(response.status, (await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  // 스트림이 아닌 JSON 응답(비스트리밍 경로)도 같은 모양으로 받는다
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return { suggestions: [], source: 'ai', ...(await response.json() as Partial<SrProposal> & { title: string; body: string }) }
  if (!response.body) throw new Error('스트림 응답이 없습니다')
  let result: SrProposal | undefined
  const reader = response.body.getReader()
  try {
    await readSse(reader, (event, data) => {
      if (event === 'delta') onDelta(String(data.text ?? ''))
      else if (event === 'completed') result = data as unknown as SrProposal
      else if (event === 'failed') throw new Error(String(data.error))
    })
    if (!result) throw new Error('AI 제안 연결이 끊어졌습니다. 다시 시도하세요')
    return result
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
/** 접수 대화 전체로 제목·본문 초안을 제안만 받는다. */
export const composeSr = (id: string, onDelta: (text: string) => void, signal?: AbortSignal) => proposal(`${path(id)}/compose`, undefined, onDelta, signal)
/** 현재 제목·본문을 다듬은 제안만 받는다(저장 없음). 적용은 사람이 한다. */
export const refineSr = (id: string, input: { title: string; body: string }, onDelta: (text: string) => void, signal?: AbortSignal) => proposal(`${path(id)}/refine`, input, onDelta, signal)
export const startSrTask = (id: string, assistantId: string, forceNew = false) => request<{ id?: string; candidates?: SrDetail['conversations'] }>(`${path(id)}/tasks`, 'POST', { assistantId, forceNew })
export const shareSr = (id: string, input: { taskId?: string; text: string; fileIds: string[] }) => request<SharedResult>(`${path(id)}/results`, 'POST', input)
export const srResults = (id: string) => request<SharedResult[]>(`${path(id)}/results`)
export async function uploadSrFile(id: string, file: File): Promise<FileMeta> {
  const form = new FormData()
  form.set('file', file)
  const response = await fetch(`/api/service-requests${path(id)}/files`, { method: 'POST', credentials: 'same-origin', body: form })
  if (!response.ok) throw new SrApiError(response.status, (await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  return response.json() as Promise<FileMeta>
}
