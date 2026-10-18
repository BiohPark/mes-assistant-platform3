import { create } from 'zustand'

export interface ChatActions { info?: () => void; exclude?: () => void; inline?: () => void; issue: boolean }
/** 대화별로 ChatView의 기존 대화상자를 헤더 메뉴에 연결한다. 전송·추정 데이터는 다루지 않는다. */
export const useTaskChatActions = create<{ byTask: Record<string, ChatActions>; set: (taskId: string, actions?: ChatActions) => void }>(set => ({
  byTask: {},
  set: (taskId, actions) => set(state => {
    const byTask = { ...state.byTask }
    if (actions) byTask[taskId] = actions
    else delete byTask[taskId]
    return { byTask }
  }),
}))
