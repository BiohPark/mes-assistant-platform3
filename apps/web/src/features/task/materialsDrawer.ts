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
  byTask: Record<string, { choice?: Choice; tool?: WorkTool; focusSeq: number; context?: string[] }>
  syncContext: (task: Task) => void
  choose: (taskId: string, choice: Choice, tool?: WorkTool, focus?: boolean) => void
}
/** 수동 선택만 저장한다. 맥락에 따른 기본값은 현재 task에서 계산한다. */
export const useMaterialsDrawer = create<DrawerState>((set) => ({
  byTask: {},
  syncContext: (task) => set(state => {
    const current = state.byTask[task.id]
    const context = [...task.tags, ...(task.linkedSrCodes ?? [])]
    const added = current?.context && context.some(value => !current.context!.includes(value))
    if (added) {
      try { sessionStorage.removeItem(key(task.id)) } catch { /* 메모리의 auto 상태 유지 */ }
    }
    return { byTask: { ...state.byTask, [task.id]: { ...current, focusSeq: current?.focusSeq ?? 0, choice: added ? undefined : current?.choice, context } } }
  }),
  choose: (taskId, choice, tool, focus = false) => {
    try { sessionStorage.setItem(key(taskId), choice) } catch { /* 저장 차단 시 현재 탭의 메모리 상태 유지 */ }
    set(state => ({ byTask: { ...state.byTask, [taskId]: { ...state.byTask[taskId], choice, tool, focusSeq: (state.byTask[taskId]?.focusSeq ?? 0) + (focus ? 1 : 0) } } }))
  },
}))
export function useDrawerOpen(task: Task) {
  const choice = useMaterialsDrawer(state => state.byTask[task.id]?.choice)
  const narrow = useMediaQuery('(max-width: 1023.98px)')
  return (choice ?? read(task.id) ?? (hasContext(task) && !narrow ? 'open' : 'closed')) === 'open'
}

/** 좁은 화면의 자동 상태는 같은 패널의 제목 바만 보인다. 수동 닫힘은 바도 숨긴다. */
export function useDrawerBar(task: Task) {
  const state = useMaterialsDrawer(s => s.byTask[task.id])
  const narrow = useMediaQuery('(max-width: 1023.98px)')
  return narrow && hasContext(task) && !(state?.choice ?? read(task.id))
}
