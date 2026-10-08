import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface HomeFilters {
  q: string
  level1CodeIds: string[]
  level2CodeIds: string[]
  showRetired: boolean
}

export const emptyHomeFilters = (): HomeFilters => ({ q: '', level1CodeIds: [], level2CodeIds: [], showRetired: false })

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
      homeFilters: emptyHomeFilters(),
      setHomeFilters: (patch) => set((s) => ({ homeFilters: { ...s.homeFilters, ...patch } })),
      kanbanCollapseEmpty: false,
      setKanbanCollapseEmpty: (kanbanCollapseEmpty) => set({ kanbanCollapseEmpty }),
      assistantOpen: false,
      setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
    }),
    { name: 'mes-hub-ui', version: 1,
      migrate: (stored) => {
        const state = stored as { homeFilters?: Partial<HomeFilters> & { level1CodeId?: string | null; level2CodeId?: string | null }; kanbanCollapseEmpty?: boolean }
        const old = state.homeFilters
        return { kanbanCollapseEmpty: state.kanbanCollapseEmpty ?? false, homeFilters: {
          q: old?.q ?? '', showRetired: old?.showRetired ?? false,
          level1CodeIds: old?.level1CodeIds ?? (old?.level1CodeId ? [old.level1CodeId] : []),
          level2CodeIds: old?.level2CodeIds ?? (old?.level2CodeId ? [old.level2CodeId] : []),
        } }
      }, partialize: (s) => ({ homeFilters: s.homeFilters, kanbanCollapseEmpty: s.kanbanCollapseEmpty }) },
  ),
)
