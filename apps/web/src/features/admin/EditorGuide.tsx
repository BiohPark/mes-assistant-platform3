import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { BookOpen, MapPin, X } from 'lucide-react'
import { useMediaQuery } from '@/app/useMediaQuery'
import { cn } from '@/lib/utils'
import { offerGuideOnce } from '@/features/assistant-pill/tutorial'
import { useT, type TranslationKey } from '@/i18n'

/** 시트 안에서 '여기예요'로 짚는 항목 */
export type EditorPointer = 'name' | 'owner' | 'paths' | 'model' | 'owui'

const ITEMS = ['name', 'paths', 'owner', 'status', 'model', 'owuiCheck', 'docUrl', 'summary', 'io', 'checklist', 'test'] as const
type GuideItem = Extract<TranslationKey, `admin.manage.guide.items.${string}`>

/**
 * 에이전트 편집 시트의 상세 가이드(S13-R) — 처음 여는 사용자에게는 펼친 채, 다음부터는 접힌 채 토글로.
 * 시트는 모달(포커스 트랩·바깥 pointer-events 차단)이라 페이지 가이드 오버레이를 쓰지 않고 시트 안에 둔다. AI를 호출하지 않는다
 */
export function EditorGuidePanel({ userId }: { userId: string }) {
  const t = useT()
  const [open, setOpen] = useState(() => offerGuideOnce(userId, 'assistantEditor'))
  const bodyId = useId()
  const titleId = useId()
  return <section aria-labelledby={titleId} className="space-y-2 rounded-xl border bg-muted/30 p-3 text-sm">
    <div className="flex items-center gap-2">
      <BookOpen aria-hidden className="size-4 shrink-0 text-primary" />
      <h3 id={titleId} className="font-medium">{t('admin.manage.guide.title')}</h3>
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((current) => !current)}
        className="ml-auto rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{t(open ? 'admin.manage.guide.hide' : 'admin.manage.guide.show')}</button>
    </div>
    {open && <div id={bodyId} className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('admin.manage.guide.intro')}</p>
      <ul className="space-y-1 text-xs leading-relaxed">{ITEMS.map((item) => <li key={item} className="flex gap-1.5"><span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" /><span>{t(`admin.manage.guide.items.${item}` as GuideItem)}</span></li>)}</ul>
    </div>}
  </section>
}

/**
 * '여기예요' 표식 — 대상 항목을 감싸 primary 테두리로 짚고 바로 아래에 안내를 단다. 보이면 화면 안으로 스크롤(모션 감소 환경은 즉시).
 * 감싸는 요소는 늘 같아(활성 여부와 무관) 입력 중인 필드가 다시 마운트되지 않고, 테두리는 바깥(ring-offset)에 그려 배치가 밀리지 않는다
 */
export function HereMarker({ active, message, onDismiss, children }: { active: boolean; message: string; onDismiss: () => void; children: ReactNode }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  useEffect(() => { if (active) ref.current?.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' }) }, [active, reduced])
  return <div ref={ref} data-testid={active ? 'here-marker' : undefined} className={cn('space-y-2 rounded-xl', active && 'ring-2 ring-primary ring-offset-4 ring-offset-background')}>
    {children}
    {active && <p role="status" className="flex items-start gap-2 rounded-lg bg-primary/10 px-2 py-1.5 text-xs leading-relaxed">
      <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <span className="flex-1"><strong>{t('admin.manage.guide.here')}</strong> {message}</span>
      <button type="button" aria-label={t('admin.manage.guide.dismiss')} onClick={onDismiss} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"><X className="size-3.5" /></button>
    </p>}
  </div>
}
