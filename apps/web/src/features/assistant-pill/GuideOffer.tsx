import { useEffect, useRef, useState, type RefObject } from 'react'
import { X } from 'lucide-react'
import { useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { useUiStore, type PillPos } from '@/app/uiStore'
import { useBubbleStore } from './bubbles'
import { pageRoute, type PageRoute } from './pageActions'
import { usePillAnchor } from './pillAnchor'
import { useTourStore } from './tour'
import { offerGuideOnce, saveGuideOffer } from './tutorial'

const WIDTH = 260
const FALLBACK_HEIGHT = 92 // 한 줄 질문 + 버튼 줄 — 렌더 전 자리 계산용

/**
 * 페이지 첫 진입 때 알약 위에서 '이 화면에서 도와드릴까요?' — 사용자·페이지별 한 번(보인 순간 기록, 답 없이 닫혀도 다시 안 묻는다).
 * 화면 조작을 막지 않는다: 알약 위(사이드바 빈 하단, 위가 모자라면 아래·늘 화면 안)에 놓이고, 버튼 3개만 포인터를 받으며(나머지는 통과), 밖에서 누르기 시작하면 접힌다.
 * 일반 말풍선 큐와는 별개 — 그쪽이 떠 있는 동안은 양보하고 사라지면 돌아온다. 창이 열려 있거나 투어 중에는 숨는다. AI를 호출하지 않는다
 */
export function GuideOffer({ userId, pillRef, pos }: { userId: string; pillRef: RefObject<HTMLButtonElement | null>; pos: PillPos | null }) {
  const t = useT()
  const { pathname } = useLocation()
  const route = pageRoute(pathname)
  const [offer, setOffer] = useState<PageRoute | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const bubbleShowing = useBubbleStore((state) => state.current !== null)
  const windowOpen = useUiStore((state) => state.assistantOpen)
  const touring = useTourStore((state) => state.route !== null)
  useEffect(() => { if (offerGuideOnce(userId, route)) setOffer(route) }, [userId, route]) // StrictMode 재실행은 false — 상태를 되돌리지 않는다
  const shown = offer === route && !bubbleShowing && !windowOpen && !touring
  const place = usePillAnchor(shown, pillRef, pos, WIDTH, { boxRef: ref, fallbackHeight: FALLBACK_HEIGHT })
  useEffect(() => {
    if (!shown) return
    const fold = (event: Event) => { if (!(event.target instanceof Node && ref.current?.contains(event.target))) setOffer(null) }
    document.addEventListener('pointerdown', fold, true)
    return () => document.removeEventListener('pointerdown', fold, true)
  }, [shown])
  const answer = (state: 'accepted' | 'skipped') => {
    saveGuideOffer(userId, route, state)
    setOffer(null)
    if (state === 'accepted') useTourStore.getState().start(route, userId)
  }

  return <div ref={ref} role="status" aria-live="polite" aria-label={t('bubble.guideRegion')} style={shown ? { left: place.left, bottom: place.bottom, width: WIDTH } : undefined}
    className={shown ? 'pointer-events-none fixed z-40 max-w-[calc(100vw-16px)]' : 'sr-only'}>
    {shown && <div data-testid="guide-offer" className="space-y-2 rounded-2xl border bg-popover p-2.5 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none">
      <div className="flex items-start gap-1">
        <p className="flex-1 leading-snug">{t('bubble.guideOffer')}</p>
        <button type="button" aria-label={t('bubble.close')} className="pointer-events-auto rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={() => setOffer(null)}><X className="size-3.5" /></button>
      </div>
      <div className="flex gap-2">
        <Button size="xs" className="pointer-events-auto" onClick={() => answer('accepted')}>{t('bubble.guideYes')}</Button>
        <Button size="xs" variant="ghost" className="pointer-events-auto" onClick={() => answer('skipped')}>{t('bubble.guideNo')}</Button>
      </div>
    </div>}
  </div>
}
