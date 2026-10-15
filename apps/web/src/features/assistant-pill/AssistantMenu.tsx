import { use, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { MeContext } from '@/app/auth'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { focusPageTarget, PAGE_ACTIONS, pageRoute, pageTarget, type PageAction } from './pageActions'
import { useTourStore } from './tour'
import { saveGuideOffer } from './tutorial'

/** 창 안 '할 수 있는 것' — 현재 페이지의 빠른 실행. 첫 항목은 늘 가이드(스포트라이트 투어, 창을 닫고 시작)이고 나머지는 이동·포커스·예시 프리필뿐이다(AI 호출 없음) */
export function AssistantMenu({ userId, prefill, perform, searchAgents }: { userId: string; prefill: (text: string) => void; perform: (action: () => void) => void; searchAgents: () => void }) {
  const t = useT()
  const me = use(MeContext)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const route = pageRoute(pathname)
  const [unavailable, setUnavailable] = useState(false)
  const owner = me?.roles.includes('system_owner') ?? false
  const actions = route === 'admin' && !owner ? PAGE_ACTIONS[route].filter(action => action.kind === 'tutorial') : PAGE_ACTIONS[route]
  function run(action: PageAction) {
    setUnavailable(false)
    if (action.kind === 'prefill') prefill(t(action.example))
    else if (action.kind === 'tutorial') { saveGuideOffer(userId, route, 'accepted'); perform(() => { useTourStore.getState().start(route, userId) }) }
    else if (action.kind === 'navigate') perform(() => { void navigate(action.to) })
    else if (action.target === 'search') perform(searchAgents)
    else if (!pageTarget(action.target, t)) setUnavailable(true)
    else perform(() => focusPageTarget(action.target, t))
  }
  return <section aria-label={t('pill.menu.title')} className="space-y-2">
    <h2 className="text-xs font-medium">{t('pill.menu.title')}</h2>
    <div className="flex flex-wrap gap-1.5">{actions.map(action => <button key={action.label} type="button" onClick={() => run(action)}
      className={cn('rounded-lg border px-2.5 py-1.5 text-left text-xs', action.kind === 'tutorial' ? 'border-primary/40 bg-primary/5 font-medium hover:bg-primary/10' : 'bg-card hover:bg-muted')}>{t(action.kind === 'prefill' ? action.example : action.label)}</button>)}</div>
    {unavailable && <p role="status" className="text-xs text-muted-foreground">{t('pill.menu.unavailable')}</p>}
  </section>
}
