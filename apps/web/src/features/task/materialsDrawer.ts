import { useMemo } from 'react'
import { create } from 'zustand'
import type { Task } from '@mes/domain'

export const RAIL_TABS = ['materials', 'checklist', 'notes', 'history'] as const
export type RailTab = typeof RAIL_TABS[number]
export type WorkTool = Exclude<RailTab, 'materials'>
type Choice = 'open' | 'closed'
const PREFIX = 'mes-hub:panel-state:'
/** 로그인 사용자 — 저장 키와 메모리 상태를 사용자별로 나눠, 같은 브라우저 탭의 다음 계정에 이전 사용자의 초안이 보이지 않게 한다 */
let owner = ''
const key = (taskId: string) => `${PREFIX}${owner}:${taskId}`
function removeStored(keep?: string) {
  try {
    for (const item of Object.keys(sessionStorage)) if (item.startsWith(PREFIX) && (keep === undefined || !item.startsWith(`${PREFIX}${keep}:`))) sessionStorage.removeItem(item)
  } catch { /* 저장소 차단 — 지울 것도 없다 */ }
}
export const drawerId = (taskId: string) => `linked-materials-drawer-${taskId}`
export interface RailState {
  owner: string
  choice: Choice
  tab: RailTab
  focusSeq: number
  seen: string[]
  scroll: Partial<Record<RailTab, number>>
  noteDraft: string
  noteAttachments: string[]
  checklistDraft: string
  materialsSearch: string
}
const initial = (): RailState => ({ owner, choice: 'closed', tab: 'materials', focusSeq: 0, seen: [], scroll: {}, noteDraft: '', noteAttachments: [], checklistDraft: '', materialsSearch: '' })
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
function read(taskId: string): RailState {
  const fallback = initial()
  try {
    const raw = sessionStorage.getItem(key(taskId))
    if (raw === 'open' || raw === 'closed') return { ...fallback, choice: raw }
    const value = JSON.parse(raw ?? 'null') as Partial<RailState> | null
    if (!value || typeof value !== 'object') return fallback
    return {
      ...fallback,
      choice: value.choice === 'open' ? 'open' : 'closed',
      tab: RAIL_TABS.includes(value.tab as RailTab) ? value.tab! : 'materials',
      seen: strings(value.seen) ? value.seen : [],
      scroll: Object.fromEntries(RAIL_TABS.flatMap(tab => {
        const top = value.scroll?.[tab]
        return typeof top === 'number' && Number.isFinite(top) && top >= 0 ? [[tab, top]] : []
      })),
      noteDraft: typeof value.noteDraft === 'string' ? value.noteDraft : '',
      noteAttachments: strings(value.noteAttachments) ? value.noteAttachments : [],
      checklistDraft: typeof value.checklistDraft === 'string' ? value.checklistDraft : '',
      materialsSearch: typeof value.materialsSearch === 'string' ? value.materialsSearch : '',
    }
  } catch { return fallback }
}
const mine = (state: RailState | undefined) => state?.owner === owner ? state : undefined
let quiet = false
/** 프로그램이 대신 누른 레일 클릭(가이드 투어 등) — 펼치기만 하고 포커스는 호출한 쪽에 둔다 */
export function withoutRailFocus(run: () => void) {
  quiet = true
  try { run() } finally { quiet = false }
}
/** 렌더 단계에서 불러도 된다(멱등, 스토어 알림 없음). 사용자가 바뀌면 다른 사용자의 세션 저장분을 지운다 — 메모리 항목은 owner로 걸러진다 */
export function bindRailToUser(userId: string) {
  if (owner === userId) return
  owner = userId
  removeStored(userId)
}
/** 로그아웃 — 이 브라우저 탭의 레일 상태(펼침·초안·스크롤)를 모두 지운다 */
export function clearRailState() {
  removeStored()
  useMaterialsDrawer.setState({ byTask: {} })
}
interface DrawerState {
  byTask: Record<string, RailState>
  update: (taskId: string, patch: Partial<RailState>) => void
  choose: (taskId: string, choice: Choice, tab?: RailTab, focus?: boolean) => void
}
/** 업무별 세션 상태. MDI 퇴거·재마운트 뒤에도 사용자의 선택과 작성 중 내용을 복원한다. */
export const useMaterialsDrawer = create<DrawerState>((set, get) => ({
  byTask: {},
  update: (taskId, patch) => set(state => {
    const next = { ...mine(state.byTask[taskId]) ?? read(taskId), ...patch, owner }
    try { sessionStorage.setItem(key(taskId), JSON.stringify(next)) } catch { /* 저장 차단 시 메모리 상태 유지 */ }
    return { byTask: { ...state.byTask, [taskId]: next } }
  }),
  choose: (taskId, choice, tab, focus = false) => {
    const current = mine(get().byTask[taskId]) ?? read(taskId)
    get().update(taskId, { choice, tab: tab ?? current.tab, focusSeq: current.focusSeq + (focus && !quiet ? 1 : 0) })
  },
}))
export function useRailState(taskId: string) {
  const user = owner
  const saved = useMemo(() => read(taskId), [taskId, user]) // eslint-disable-line react-hooks/exhaustive-deps -- user는 read가 쓰는 모듈 owner의 렌더 시점 값
  return mine(useMaterialsDrawer(state => state.byTask[taskId])) ?? saved
}
export function useDrawerOpen(task: Task) {
  return useRailState(task.id).choice === 'open'
}
