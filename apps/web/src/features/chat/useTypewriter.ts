import { useEffect, useReducer, useRef } from 'react'
import { useMediaQuery } from '@/app/useMediaQuery'

const TICK_MS = 40
/** 조각 간격이 이보다 짧으면(직접 스트리밍) 이 시간 안에 따라잡는다 */
const MIN_SPREAD_MS = 80
/** 조각 간격이 이보다 길면(첫 조각·긴 정적) 이 시간에 걸쳐 푼다 — 세션 폴링 간격(1초)과 같다 */
const MAX_SPREAD_MS = 1000

function commonPrefix(a: string, b: string) {
  let index = 0
  while (index < a.length && index < b.length && a[index] === b[index]) index++
  return index
}

/**
 * 스트리밍 중 새로 들어온 글을 다음 조각이 올 때까지 일정 속도로 풀어 보인다(화면 표시 전용 — 저장·복사·검색은 원문).
 * 밀린 분량이 있으면 다음 조각 때 남은 전체를 새 간격에 맞춰 속도를 올린다. 끝나거나 reduced motion이면 원문을 그대로 낸다.
 */
export function useTypewriter(text: string, active: boolean): string {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const animate = active && !reduced
  const shown = useRef(text.length)
  const target = useRef({ text, changedAt: Date.now(), rate: 0 })
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)
  const [, render] = useReducer((count: number) => count + 1, 0)

  useEffect(() => {
    const state = target.current
    const now = Date.now()
    shown.current = Math.min(shown.current, commonPrefix(state.text, text))
    const gap = now - state.changedAt
    state.text = text
    state.changedAt = now
    if (!animate) {
      shown.current = text.length
      clearInterval(timer.current)
      timer.current = undefined
      return
    }
    const backlog = text.length - shown.current
    if (backlog <= 0) return
    state.rate = backlog / Math.min(MAX_SPREAD_MS, Math.max(MIN_SPREAD_MS, gap))
    if (timer.current) return
    let last = now, carry = 0
    timer.current = setInterval(() => {
      const tick = Date.now()
      carry += (tick - last) * target.current.rate
      last = tick
      const step = Math.floor(carry)
      if (!step) return
      carry -= step
      const full = target.current.text
      let next = Math.min(full.length, shown.current + step)
      const code = full.charCodeAt(next - 1)
      if (code >= 0xd800 && code <= 0xdbff) next++ // 서로게이트 쌍을 가르지 않는다
      shown.current = next
      render()
      if (next >= full.length) { clearInterval(timer.current); timer.current = undefined }
    }, TICK_MS)
  }, [text, animate])

  useEffect(() => () => clearInterval(timer.current), [])

  return animate ? text.slice(0, Math.min(shown.current, text.length)) : text
}
