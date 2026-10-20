import type { QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { getCandidates, type Candidates } from '@/api/files'
import { useBubbleStore } from '@/features/assistant-pill/bubbles'

/** 방금 들어온·빠진 표시를 남겨 두는 시간 */
export const FRESH_MS = 30_000

export interface ShareItem { id: string; kind: 'file' | 'conversation'; label: string }

/** 자료함의 같은 태그 항목 — 다른 대화의 최신 파일(MaterialsPanel '같은 태그'와 같은 기준)과 같은 태그 대화 */
export function sharedItems(taskId: string, data: Candidates): ShareItem[] {
  return [
    ...data.files.filter((item) => item.sourceTaskId !== taskId && item.viaTags.length && !item.newerVersionId)
      .map((item): ShareItem => ({ id: item.file.id, kind: 'file', label: item.file.name })),
    ...data.conversations.map((item): ShareItem => ({ id: item.taskId, kind: 'conversation', label: item.code })),
  ]
}

export function shareDiff(before: ShareItem[], after: ShareItem[]) {
  const had = new Set(before.map((item) => item.id)), has = new Set(after.map((item) => item.id))
  return { added: after.filter((item) => !had.has(item.id)), removed: before.filter((item) => !has.has(item.id)) }
}

interface TagShareState {
  byTask: Record<string, { fresh: string[]; gone: ShareItem[] }>

}
export const useTagShareStore = create<TagShareState>()(() => ({
  byTask: {},
}))
const timers = new Map<string, ReturnType<typeof setTimeout>>()
function mark(taskId: string, entry: { fresh: string[]; gone: ShareItem[] }) {
  clearTimeout(timers.get(taskId))
  useTagShareStore.setState((state) => ({ byTask: { ...state.byTask, [taskId]: entry } }))
  timers.set(taskId, setTimeout(() => {
    timers.delete(taskId)
    useTagShareStore.setState((state) => { const { [taskId]: _done, ...rest } = state.byTask; return { byTask: rest } })
  }, FRESH_MS))
}
const counts = (items: ShareItem[]) => ({ conversations: items.filter((item) => item.kind === 'conversation').length, files: items.filter((item) => item.kind === 'file').length })

/**
 * 태그를 바꾸고(action) 그 전후 자료함 후보를 직접 다시 읽어 비교한다 — 전역 SSE가 늦거나 끊겨도 자료함이 새 태그 기준으로 바뀐다.
 * 들어온 항목은 표시(fresh)하고 빠진 항목은 잠시 남기며, 도우미 말풍선으로 '같은 태그 대화 n·파일 m'을 알린다. 자동으로 첨부하지 않는다.
 */
export async function changeTagWithShare(query: QueryClient, taskId: string, action: () => Promise<unknown>) {
  const key = ['candidates', taskId]
  const before = query.getQueryData<Candidates>(key) ?? await getCandidates(taskId).catch(() => undefined)
  await action()
  await query.cancelQueries({ queryKey: key }) // 태그 변경 전에 시작한 조회가 새 결과를 덮지 않게
  for (const related of [['candidate-count', taskId], ['conversation-inputs', taskId], ['sr-inputs', taskId], ['estimate']]) void query.invalidateQueries({ queryKey: related })
  // 태그는 이미 바뀌었다 — 다시 읽기가 실패하면 표시 없이 자료함 조회에 맡긴다
  const after = await getCandidates(taskId).catch(() => undefined)
  if (!after) { void query.invalidateQueries({ queryKey: key }); return }
  query.setQueryData(key, after)
  if (!before) return
  const { added, removed } = shareDiff(sharedItems(taskId, before), sharedItems(taskId, after))
  if (added.length || removed.length) mark(taskId, { fresh: added.map((item) => item.id), gone: removed })
  const bubble = { key: taskId }
  if (added.length) useBubbleStore.getState().push({ ...bubble, source: 'share.in', counts: counts(added) })
  else if (removed.length) useBubbleStore.getState().push({ ...bubble, source: 'share.out', counts: counts(removed) })
  else useBubbleStore.getState().push({ ...bubble, source: 'share.none' })
}
