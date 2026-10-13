import type { QueryClient } from '@tanstack/react-query'
import { queryClient } from './queryClient'

/** 같은 태그 패널의 담기 1건 — 대화 본문은 전체 스냅샷(full)만, 파일은 참고 입력, 담긴 버전 교체는 switch-version */
export type ComposeOp =
  | { kind: 'conversation'; sourceTaskId: string; label: string }
  | { kind: 'file'; fileId: string; label: string }
  | { kind: 'switch'; fromFileId: string; toFileId: string; label: string }
export type ComposeResult = { op: ComposeOp; status: 'done' } | { op: ComposeOp; status: 'failed'; reason: string } | { op: ComposeOp; status: 'pending' }

async function send(url: string, method: string, body: unknown): Promise<void> {
  const response = await fetch(url, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`)
}
function run(taskId: string, op: ComposeOp) {
  const task = `/api/tasks/${encodeURIComponent(taskId)}`
  if (op.kind === 'conversation') return send(`${task}/conversation-inputs/${encodeURIComponent(op.sourceTaskId)}`, 'PUT', { mode: 'full' })
  if (op.kind === 'file') return send(`${task}/inputs/${encodeURIComponent(op.fileId)}`, 'PUT', { weight: 'reference' })
  return send(`${task}/inputs/${encodeURIComponent(op.fromFileId)}/switch-version`, 'POST', { toFileId: op.toFileId })
}

/**
 * 기존 API로 하나씩 순서대로 담는다(일괄 API 없음). 첫 실패에서 멈추고 사유를 남기며, 나머지는 미처리로 돌려준다.
 * 하나라도 담겼으면 끝에서 한 번만 새로 고친다 — 추정은 1회만 다시 계산된다.
 */
export async function composeInputs(taskId: string, ops: ComposeOp[], client: QueryClient = queryClient): Promise<ComposeResult[]> {
  const results: ComposeResult[] = ops.map((op) => ({ op, status: 'pending' }))
  for (const [index, op] of ops.entries()) {
    try { await run(taskId, op); results[index] = { op, status: 'done' } }
    catch (error) { results[index] = { op, status: 'failed', reason: error instanceof Error ? error.message : String(error) }; break }
  }
  if (results.some((item) => item.status === 'done')) {
    for (const queryKey of [['candidates'], ['files'], ['conversation-inputs', taskId], ['task', taskId], ['estimate']]) void client.invalidateQueries({ queryKey })
  }
  return results
}
