import { useCallback, useRef, useState } from 'react'

export type SaveState = { status: 'saving' } | { status: 'saved' } | { status: 'error'; message: string }

/** 필드별 즉시 저장 상태(저장 중·저장됨·오류). 같은 키의 늦은 응답은 최신 호출 결과를 덮어쓰지 않는다 */
export function useAutoSave<K extends string>() {
  const [states, setStates] = useState<Partial<Record<K, SaveState>>>({})
  const sequence = useRef<Partial<Record<K, number>>>({})
  const set = useCallback((key: K, state?: SaveState) => setStates(current => ({ ...current, [key]: state })), [])
  const run = useCallback(async (key: K, task: () => Promise<unknown>): Promise<boolean> => {
    const id = (sequence.current[key] ?? 0) + 1
    sequence.current[key] = id
    set(key, { status: 'saving' })
    try { await task() }
    catch (error) {
      if (sequence.current[key] === id) set(key, { status: 'error', message: error instanceof Error ? error.message : '' })
      return false
    }
    if (sequence.current[key] === id) set(key, { status: 'saved' })
    return true
  }, [set])
  const fail = useCallback((key: K, message: string) => { sequence.current[key] = (sequence.current[key] ?? 0) + 1; set(key, { status: 'error', message }) }, [set])
  /** 값이 저장값으로 돌아왔을 때처럼 표시를 지운다 */
  const clear = useCallback((key: K) => { sequence.current[key] = (sequence.current[key] ?? 0) + 1; set(key, undefined) }, [set])
  return { states, run, fail, clear }
}
