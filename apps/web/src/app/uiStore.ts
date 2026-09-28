import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface HomeFilters {
  q: string
  level1: string | null
  level2: string | null
  showRetired: boolean
}

interface UiState {
  homeFilters: HomeFilters
  setHomeFilters: (patch: Partial<HomeFilters>) => void
  /** 칸반에서 대화 없는 열을 좁게 접기 */
  kanbanCollapseEmpty: boolean
  setKanbanCollapseEmpty: (v: boolean) => void
  assistantOpen: boolean
  setAssistantOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      homeFilters: { q: '', level1: null, level2: null, showRetired: false },
      // Lv1이 바뀌면 Lv2 선택은 무효
      setHomeFilters: (patch) =>
        set((s) => ({ homeFilters: { ...s.homeFilters, ...patch, level2: 'level1' in patch && patch.level1 !== s.homeFilters.level1 ? null : (patch.level2 !== undefined ? patch.level2 : s.homeFilters.level2) } })),
      kanbanCollapseEmpty: false,
      setKanbanCollapseEmpty: (kanbanCollapseEmpty) => set({ kanbanCollapseEmpty }),
      assistantOpen: false,
      setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
    }),
    { name: 'mes-hub-ui', partialize: (s) => ({ homeFilters: s.homeFilters, kanbanCollapseEmpty: s.kanbanCollapseEmpty }) },
  ),
)
