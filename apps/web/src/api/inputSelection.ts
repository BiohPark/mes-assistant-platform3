import { create } from 'zustand'

/** All selection entry points share a lock through saving, refresh and request submission. */
export const inputSelection = create<{ byTask: Record<string, { pending: number; revision: number; sending?: boolean }> }>(() => ({ byTask: {} }))
export function lockInputSend(taskId: string): (() => void) | undefined {
  const current = inputSelection.getState().byTask[taskId] ?? { pending: 0, revision: 0 }
  if (current.pending || current.sending) return
  inputSelection.setState(state => ({ byTask: { ...state.byTask, [taskId]: { ...current, sending: true } } }))
  return () => inputSelection.setState(state => ({ byTask: { ...state.byTask, [taskId]: { ...state.byTask[taskId]!, sending: false } } }))
}
export async function saveInputSelection<T>(taskId: string, action: () => Promise<T>): Promise<T> {
  if (inputSelection.getState().byTask[taskId]?.sending) throw new Error('MATERIALS_SENDING')
  const update = (delta: number) => inputSelection.setState(state => {
    const current = state.byTask[taskId] ?? { pending: 0, revision: 0 }
    return { byTask: { ...state.byTask, [taskId]: { ...current, pending: current.pending + delta, revision: current.revision + (delta < 0 ? 1 : 0) } } }
  })
  update(1)
  try { return await action() } finally { update(-1) }
}
