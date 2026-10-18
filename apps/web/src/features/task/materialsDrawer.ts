import type { TaskMessageState } from '@mes/contracts'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMessages } from '@/api/tasks'
import { create } from 'zustand'
import { useMediaQuery } from '@/app/useMediaQuery'
import type { Task } from '@mes/domain'

export type WorkTool = 'checklist' | 'notes' | 'history'
type Choice = 'open' | 'closed'
const key = (taskId: string) => `mes-hub:panel-state:${taskId}`
export const drawerId = (taskId: string) => `linked-materials-drawer-${taskId}`
export const hasContext = (task: Task) => task.tags.length > 0 || !!task.linkedSrCodes?.length
function read(taskId: string): Choice | undefined {
  try { const value = sessionStorage.getItem(key(taskId)); return value === 'open' || value === 'closed' ? value : undefined } catch { return undefined }
}
interface DrawerState {
  byTask: Record<string, { choice?: Choice; tool?: WorkTool; focusSeq: number; context?: string[]; started?: boolean }>
  markStarted: (taskId: string) => void
  syncContext: (task: Task) => void
  choose: (taskId: string, choice: Choice, tool?: WorkTool, focus?: boolean) => void
}
/** 수동 선택만 저장한다. 맥락에 따른 기본값은 현재 task에서 계산한다. */
export const useMaterialsDrawer = create<DrawerState>((set) => ({
  byTask: {},
  markStarted: (taskId) => set(state => ({ byTask: { ...state.byTask, [taskId]: { ...state.byTask[taskId], focusSeq: state.byTask[taskId]?.focusSeq ?? 0, started: true } } })),
  syncContext: (task) => set(state => {
    const current = state.byTask[task.id]
    const context = [...task.tags, ...(task.linkedSrCodes ?? [])]
    return { byTask: { ...state.byTask, [task.id]: { ...current, focusSeq: current?.focusSeq ?? 0, context } } }
  }),
  choose: (taskId, choice, tool, focus = false) => {
    try { sessionStorage.setItem(key(taskId), choice) } catch { /* 저장 차단 시 현재 탭의 메모리 상태 유지 */ }
    set(state => ({ byTask: { ...state.byTask, [taskId]: { ...state.byTask[taskId], choice, tool, focusSeq: (state.byTask[taskId]?.focusSeq ?? 0) + (focus ? 1 : 0) } } }))
  },
}))
function useFirstQuestion(task: Task) {
  const messages = useQuery({ queryKey: ['messages', task.threadId], queryFn: ({ signal }) => getMessages(task.threadId!, signal), enabled: !!task.threadId })
  const started = useMaterialsDrawer(state => state.byTask[task.id]?.started)
  useEffect(() => { if (messages.data?.length && !started) useMaterialsDrawer.getState().markStarted(task.id) }, [messages.data?.length, started, task.id])
  // 메시지 로딩 동안 기존 자동 상태를 유지한다. 첫 렌더는 첫 질문 상태로 시작한다.
  return !started && (messages.data ? messages.data.length === 0 : !(task as Task & Partial<TaskMessageState>).hasMessages)
}
export function useDrawerOpen(task: Task) {
  const firstQuestion = useFirstQuestion(task)
  const choice = useMaterialsDrawer(state => state.byTask[task.id]?.choice)
  const narrow = useMediaQuery('(max-width: 1023.98px)')
  return (choice ?? read(task.id) ?? (hasContext(task) && firstQuestion && !narrow ? 'open' : 'closed')) === 'open'
}

/** 좁은 화면의 자동 상태는 같은 패널의 제목 바만 보인다. 수동 닫힘은 바도 숨긴다. */
export function useDrawerBar(task: Task) {
  const firstQuestion = useFirstQuestion(task)
  const state = useMaterialsDrawer(s => s.byTask[task.id])
  const narrow = useMediaQuery('(max-width: 1023.98px)')
  return narrow && firstQuestion && hasContext(task) && !(state?.choice ?? read(task.id))
}
