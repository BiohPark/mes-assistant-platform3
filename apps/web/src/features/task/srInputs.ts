import { queryClient } from '@/api/queryClient'

/**
 * 연결 SR 본문 첨부(s14-sr-body-once 서버 작업 전제) — GET/PUT/DELETE /api/tasks/:id/sr-inputs[/:srId].
 * 서버가 웹 api 클라이언트(apps/web/src/api)를 추가하면 그쪽으로 바꾸고 이 파일을 지운다.
 * 목록 쿼리 키는 ['candidates', taskId, 'sr-inputs'] — 기존 input.updated의 후보 무효화가 이 목록도 다시 읽게 한다.
 */
export interface TaskSrInput { srId: string; code: string; title: string; bytes: number; selected: boolean; used: boolean }

const path = (taskId: string, srId?: string) => `/api/tasks/${encodeURIComponent(taskId)}/sr-inputs${srId ? `/${encodeURIComponent(srId)}` : ''}`

export const srInputsKey = (taskId: string) => ['candidates', taskId, 'sr-inputs'] as const

export async function listSrInputs(taskId: string): Promise<TaskSrInput[]> {
  const response = await fetch(path(taskId), { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<TaskSrInput[]>
}

export async function setSrInput(taskId: string, srId: string, selected: boolean) {
  const response = await fetch(path(taskId, srId), { method: selected ? 'PUT' : 'DELETE', credentials: 'same-origin' })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
  void queryClient.invalidateQueries({ queryKey: ['candidates', taskId] })
  void queryClient.invalidateQueries({ queryKey: ['estimate'] })
}
