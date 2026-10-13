import { use, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { MeContext } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { focusPageTarget, PAGE_ACTIONS, pageRoute, pageTarget, type PageAction } from './pageActions'
import { askTutorialOnce, saveTutorialState, takeTutorialReplay, TUTORIAL_REPLAY } from './tutorial'

export function AssistantMenu({ userId, prefill, perform }: { userId: string; prefill: (text: string) => void; perform: (action: () => void) => void }) {
  const t = useT()
  const me = use(MeContext)
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const route = pageRoute(pathname)
  const [tutorial, setTutorial] = useState<{ userId: string; stage: 'ask' | 'step' } | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const stage = tutorial?.userId === userId ? tutorial.stage : null
  useEffect(() => {
    const replay = () => { if (takeTutorialReplay(userId)) setTutorial({ userId, stage: 'step' }) }
    if (takeTutorialReplay(userId)) setTutorial({ userId, stage: 'step' })
    else if (askTutorialOnce(userId)) setTutorial({ userId, stage: 'ask' })
    window.addEventListener(TUTORIAL_REPLAY, replay)
    return () => window.removeEventListener(TUTORIAL_REPLAY, replay)
  }, [userId])
  const start = () => { saveTutorialState(userId, 'accepted'); setTutorial({ userId, stage: 'step' }) }
  const skip = () => { saveTutorialState(userId, 'skipped'); setTutorial(null) }
  const owner = me?.roles.includes('system_owner') ?? false
  const actions = route === 'admin' && !owner ? [] : PAGE_ACTIONS[route]
  function run(action: PageAction) {
    setUnavailable(false)
    if (action.kind === 'prefill') prefill(t(action.example))
    else if (action.kind === 'tutorial') start()
    else if (action.kind === 'navigate') perform(() => { void navigate(action.to) })
    else if (action.target !== 'search' && !pageTarget(action.target, t)) setUnavailable(true)
    else perform(() => {
      if (action.target === 'search' && !pageTarget('search', t)) {
        // The hub may be showing the kanban view. Switch through its existing URL contract.
        const params = new URLSearchParams(search)
        params.delete('view')
        void Promise.resolve(navigate({ pathname, search: params.toString() })).then(() => focusPageTarget('search', t))
      } else focusPageTarget(action.target, t)
    })
  }
  return <>
    {stage && <section aria-label={t('tutorial.title')} className="space-y-2 rounded-lg border bg-primary/5 p-3 text-xs">
      <p className="font-semibold">{t(stage === 'ask' ? 'tutorial.ask' : 'tutorial.step')}</p>
      {stage === 'step' && <p>{t(`tutorial.pages.${route}`)}</p>}
      <div className="flex gap-2">{stage === 'ask' ? <Button size="xs" onClick={start}>{t('tutorial.accept')}</Button> : <Button size="xs" onClick={() => setTutorial(null)}>{t('tutorial.finish')}</Button>}<Button size="xs" variant="ghost" onClick={skip}>{t('tutorial.skip')}</Button></div>
    </section>}
    {actions.length > 0 && <section aria-label={t('pill.menu.title')} className="space-y-2">
      <h2 className="text-xs font-medium">{t('pill.menu.title')}</h2>
      <div className="flex flex-wrap gap-1.5">{actions.map(action => <button key={action.label} type="button" onClick={() => run(action)} className="rounded-lg border bg-card px-2.5 py-1.5 text-left text-xs hover:bg-muted">{t(action.kind === 'prefill' ? action.example : action.label)}</button>)}</div>
      {unavailable && <p role="status" className="text-xs text-muted-foreground">{t('pill.menu.unavailable')}</p>}
    </section>}
  </>
}
