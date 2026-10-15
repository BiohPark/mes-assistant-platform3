import { useLayoutEffect, useState, type RefObject } from 'react'
import type { PillPos } from '@/app/uiStore'

const MARGIN = 8

/** 알약 위/아래에 놓을 상자 — 높이는 렌더된 요소에서 재고, 아직 없으면 추정값 */
export interface StackedBox { boxRef: RefObject<HTMLElement | null>; fallbackHeight: number }

/**
 * 알약 곁 자리(fixed left·bottom). 알약을 옮기면(pos) 따라간다. 말풍선과 가이드 제안이 같이 쓴다.
 * 기본 — 오른쪽에 width가 들어가면 오른쪽, 아니면 왼쪽(알약과 같은 높이).
 * stacked — 알약 바로 위, 왼쪽 맞춤. 위에 자리가 없으면 알약 아래. 가로·세로 모두 화면 안으로 clamp —
 *   알약 기본 자리(사이드바 하단)에서는 사이드바의 빈 예약 구역 위에 놓여 입력창 도구줄을 덮지 않는다
 */
export function usePillAnchor(active: boolean, pillRef: RefObject<HTMLButtonElement | null>, pos: PillPos | null, width: number, stacked?: StackedBox) {
  const [place, setPlace] = useState<{ left: number; bottom: number }>({ left: MARGIN, bottom: MARGIN })
  const boxRef = stacked?.boxRef
  const fallbackHeight = stacked?.fallbackHeight
  useLayoutEffect(() => {
    if (!active) return
    const compute = () => {
      const rect = pillRef.current?.getBoundingClientRect()
      if (boxRef) {
        const height = boxRef.current?.offsetHeight || fallbackHeight || 0
        const left = Math.min(Math.max(rect?.left ?? MARGIN, MARGIN), Math.max(MARGIN, window.innerWidth - width - MARGIN))
        const pillTop = rect?.top ?? window.innerHeight
        const wanted = pillTop - MARGIN - height >= MARGIN ? pillTop - MARGIN - height : (rect?.bottom ?? window.innerHeight) + MARGIN
        const top = Math.min(Math.max(wanted, MARGIN), Math.max(MARGIN, window.innerHeight - height - MARGIN))
        setPlace({ left, bottom: window.innerHeight - top - height })
        return
      }
      const right = (rect?.right ?? 0) + MARGIN
      const left = right + width + MARGIN <= window.innerWidth ? right : Math.max(MARGIN, (rect?.left ?? window.innerWidth) - width - MARGIN)
      setPlace({ left, bottom: Math.max(MARGIN, window.innerHeight - (rect?.bottom ?? window.innerHeight)) })
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [active, pos, pillRef, width, boxRef, fallbackHeight])
  return place
}
