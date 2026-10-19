import type { AnswerDetail } from '@mes/domain'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface HomeFilters {
  q: string
  level1CodeIds: string[]
  level2CodeIds: string[]
  showRetired: boolean
}
/** AI 도우미 알약의 화면 좌표(px, 왼쪽 위). null = 기본 위치(우하단) */
export interface PillPos { x: number; y: number }

export const emptyHomeFilters = (): HomeFilters => ({ q: '', level1CodeIds: [], level2CodeIds: [], showRetired: false })

interface UiState {
  answerDetails: Record<string, AnswerDetail>
  setAnswerDetail: (userId: string, detail: AnswerDetail) => void
  homeFilters: HomeFilters
  setHomeFilters: (patch: Partial<HomeFilters>) => void
  /** 칸반에서 대화 없는 열을 좁게 접기 */
  kanbanCollapseEmpty: boolean
  setKanbanCollapseEmpty: (v: boolean) => void
  kanbanCompleted: Record<string, boolean>
  setKanbanCompleted: (userId: string, value: boolean) => void
  assistantOpen: boolean
  setAssistantOpen: (open: boolean) => void
  pillPos: PillPos | null
  setPillPos: (pos: PillPos | null) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      answerDetails: {},
      setAnswerDetail: (userId, detail) => set(s => ({ answerDetails: { ...s.answerDetails, [userId]: detail } })),
      homeFilters: emptyHomeFilters(),
      setHomeFilters: (patch) => set((s) => ({ homeFilters: { ...s.homeFilters, ...patch } })),
      kanbanCollapseEmpty: false,
      setKanbanCollapseEmpty: (kanbanCollapseEmpty) => set({ kanbanCollapseEmpty }),
      kanbanCompleted: {},
      setKanbanCompleted: (userId, value) => set(s => ({ kanbanCompleted: { ...s.kanbanCompleted, [userId]: value } })),
      assistantOpen: false,
      setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
      pillPos: null,
      setPillPos: (pillPos) => set({ pillPos }),
    }),
    { name: 'mes-hub-ui', version: 1,
      migrate: (stored) => {
        const state = stored as Partial<Pick<UiState, 'answerDetails' | 'kanbanCompleted' | 'pillPos'>> & { homeFilters?: Partial<HomeFilters> & { level1CodeId?: string | null; level2CodeId?: string | null }; kanbanCollapseEmpty?: boolean }
        const old = state.homeFilters
        return { answerDetails: state.answerDetails ?? {}, kanbanCompleted: state.kanbanCompleted ?? {}, pillPos: state.pillPos ?? null, kanbanCollapseEmpty: state.kanbanCollapseEmpty ?? false, homeFilters: {
          q: old?.q ?? '', showRetired: old?.showRetired ?? false,
          level1CodeIds: old?.level1CodeIds ?? (old?.level1CodeId ? [old.level1CodeId] : []),
          level2CodeIds: old?.level2CodeIds ?? (old?.level2CodeId ? [old.level2CodeId] : []),
        } }
      }, partialize: (s) => ({ answerDetails: s.answerDetails, homeFilters: s.homeFilters, kanbanCollapseEmpty: s.kanbanCollapseEmpty, pillPos: s.pillPos, kanbanCompleted: s.kanbanCompleted }) },
  ),
)

// 같은 브라우저의 다른 창(팝아웃)이 저장한 설정을 따른다 — 답변 표시 모드가 창마다 어긋나지 않게
if (typeof window !== 'undefined') window.addEventListener('storage', (event) => {
  if (event.key === 'mes-hub-ui') void useUiStore.persist.rehydrate()
})
