import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckSquare, Files, History, StickyNote, PanelRightClose } from 'lucide-react'
import type { Task } from '@mes/domain'
import { getActivity, getNotes } from '@/api/tasks'
import { useMediaQuery } from '@/app/useMediaQuery'
import { useTabActive } from '@/app/tabActive'
import { useMaterialCandidates } from '@/features/chat/useMaterialCandidates'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { ActivityPanel } from './ActivityPanel'
import { MaterialsPanel } from './MaterialsPanel'
import { ChecklistPanel } from './ChecklistPanel'
import { NotesPanel } from './NotesPanel'
import { drawerId, RAIL_TABS, useMaterialsDrawer, useRailState, type RailTab } from './materialsDrawer'

const icons = { materials: Files, checklist: CheckSquare, notes: StickyNote, history: History }

/** 레일은 유일한 진입점. 내용은 hidden으로 유지하고 MDI 퇴거에 필요한 상태만 세션에 둔다. */
export function TaskRail({ task, children }: { task: Task; children: ReactNode }) {
  const t = useT()
  const ids = useId()
  const state = useRailState(task.id)
  const open = state.choice === 'open'
  const narrow = useMediaQuery('(max-width: 1023.98px)')
  const active = useTabActive()
  const choose = useMaterialsDrawer(s => s.choose)
  const update = useMaterialsDrawer(s => s.update)
  const entries = useRef<Partial<Record<RailTab, HTMLButtonElement | null>>>({})
  const tabs = useRef<Partial<Record<RailTab, HTMLButtonElement | null>>>({})
  const [visited, setVisited] = useState<RailTab[]>(open ? [state.tab] : [])
  const focusSeq = useRef(state.focusSeq)
  const { candidates, own, srBodies } = useMaterialCandidates(task.id)
  const notes = useQuery({ queryKey: ['notes', task.id], queryFn: () => getNotes(task.id) })
  const activity = useQuery({ queryKey: ['activity', task.id], queryFn: () => getActivity(task.id), enabled: open && state.tab === 'history' && active })
  const candidateIds = useMemo(() => [...new Set([
    ...(own.data ?? []).map(file => `file:${file.id}`),
    ...(candidates.data?.files ?? []).filter(item => !item.newerVersionId || task.inputs.some(input => input.fileId === item.file.id)).map(item => `file:${item.file.id}`),
    ...(candidates.data?.srFiles ?? []).map(item => `file:${item.file.id}`),
    ...(candidates.data?.conversations ?? []).map(item => `conversation:${item.taskId}`),
    ...(srBodies.data ?? []).map(item => `sr:${item.srId}`),
  ])], [own.data, candidates.data, srBodies.data, task.inputs])
  const unseen = candidateIds.filter(id => !state.seen.includes(id)).length
  useEffect(() => {
    if (open) setVisited(current => current.includes(state.tab) ? current : [...current, state.tab])
    if (active && open && state.tab === 'materials' && unseen) update(task.id, { seen: [...new Set([...state.seen, ...candidateIds])] })
  }, [open, state.tab, state.seen, unseen, candidateIds, task.id, update, active])
  useLayoutEffect(() => {
    if (open && active && state.focusSeq !== focusSeq.current) tabs.current[state.tab]?.focus()
    focusSeq.current = state.focusSeq
  }, [open, active, state.focusSeq, state.tab])
  const label = (tab: RailTab) => t(`task.rail.${tab}`)
  const panelId = (tab: RailTab) => `work-panel-${ids}-${tab}`
  const tabId = (tab: RailTab) => `work-tab-${ids}-${tab}`
  const close = () => { choose(task.id, 'closed'); entries.current[state.tab]?.focus() }
  function switchKey(event: KeyboardEvent, current: RailTab) {
    const index = RAIL_TABS.indexOf(current)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : event.key === 'ArrowRight' ? (index + 1) % 4 : event.key === 'ArrowLeft' ? (index + 3) % 4 : undefined
    if (next === undefined) return
    event.preventDefault()
    const tab = RAIL_TABS[next]!
    choose(task.id, 'open', tab)
    tabs.current[tab]?.focus()
  }
  const missing = task.checklist.filter(item => item.required && !item.checked).length
  const missingId = `work-missing-${ids}`
  const badge = (tab: RailTab) => tab === 'materials' ? (unseen ? t('task.rail.new', { count: unseen }) : null)
    : tab === 'checklist' ? `${task.checklist.filter(item => item.checked).length}/${task.checklist.length}`
    : tab === 'notes' && notes.data?.length ? String(notes.data.length) : null
  return <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row" data-testid="task-body">
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t('task.conversation')}>{children}</section>
    <aside hidden={!open} id={drawerId(task.id)} role={narrow ? 'dialog' : undefined} aria-modal={narrow ? false : undefined}
      aria-label={narrow ? t('task.body.panel') : t('task.materials.linkedLibrary')} tabIndex={-1}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
      className={cn('z-20 flex min-h-0 shrink-0 flex-col overflow-hidden border bg-background', narrow ? 'absolute inset-x-0 bottom-16 h-[70%] max-h-[70%] rounded-t-xl shadow-xl' : 'w-[360px] border-y-0 border-r-0')}>
      <div className="flex shrink-0 items-center border-b px-1">
        <div role="tablist" aria-label={t('task.body.panelTabs')} className="grid min-w-0 flex-1 grid-cols-4">
          {RAIL_TABS.map(tab => <button key={tab} ref={node => { tabs.current[tab] = node }} id={tabId(tab)} type="button" role="tab" aria-selected={state.tab === tab} aria-controls={panelId(tab)} tabIndex={state.tab === tab ? 0 : -1}
            className={cn('min-h-11 border-b-2 px-1 text-xs focus-visible:outline-2 focus-visible:outline-ring', state.tab === tab ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground')}
            onKeyDown={event => switchKey(event, tab)} onClick={() => { if (state.tab === tab) close(); else choose(task.id, 'open', tab) }}>{label(tab)}</button>)}
        </div>
        <button type="button" aria-label={t('task.rail.collapse')} title={t('task.rail.collapse')} className="rounded-md p-2 hover:bg-muted" onClick={close}><PanelRightClose className="size-4" aria-hidden /></button>
      </div>
      {RAIL_TABS.map(tab => <RailPanel key={tab} id={panelId(tab)} labelledBy={tabId(tab)} taskId={task.id} tab={tab} visible={open && state.tab === tab}>
        {(visited.includes(tab) || (open && state.tab === tab)) && (tab === 'materials' ? <MaterialsPanel task={task} embedded />
          : tab === 'checklist' ? <ChecklistPanel task={task} />
          : tab === 'notes' ? <NotesPanel task={task} />
          : <><h3 className="mb-2 text-sm font-medium">{t('task.body.history')}</h3>{activity.isError ? <div role="alert" className="text-xs">{t('task.activity.loadFailed')} <button type="button" className="underline" onClick={() => void activity.refetch()}>{t('common.retry')}</button></div> : activity.isSuccess ? <ActivityPanel activity={activity.data} /> : <p role="status" className="p-4 text-center text-xs text-muted-foreground">{t('common.loading')}</p>}</>)}
      </RailPanel>)}
    </aside>
    <nav aria-label={t('task.rail.label')} data-layout={narrow ? 'bottom' : 'right'} className={cn('shrink-0 border-l bg-card', narrow ? 'grid h-16 grid-cols-4 border-t' : 'flex w-14 flex-col items-stretch gap-2 py-2')}>
      {RAIL_TABS.map(tab => { const Icon = icons[tab]; const value = badge(tab); return <button key={tab} type="button" ref={node => { entries.current[tab] = node }}
        aria-pressed={open && state.tab === tab} aria-expanded={open && state.tab === tab} aria-controls={panelId(tab)} aria-describedby={tab === 'checklist' && missing ? missingId : undefined} data-tour={tab === 'materials' ? 'linked-materials' : undefined}
        title={label(tab)} className={cn('relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-md text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring', open && state.tab === tab && 'bg-muted text-primary')}
        onClick={() => { if (open && state.tab === tab) close(); else choose(task.id, 'open', tab, true) }}>
        <Icon className="size-4" aria-hidden /><span>{label(tab)}</span>{value && <span className={cn('rounded-md bg-muted px-1 text-[11px] leading-4', tab === 'checklist' && missing ? 'text-tone-warning-fg' : 'text-muted-foreground')}>{value}</span>}
        {tab === 'checklist' && missing > 0 && <span id={missingId} className="sr-only">{t('task.rail.requiredMissing', { count: missing })}</span>}
      </button> })}
    </nav>
  </div>
}

function RailPanel({ id, labelledBy, taskId, tab, visible, children }: { id: string; labelledBy: string; taskId: string; tab: RailTab; visible: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const active = useTabActive()
  const update = useMaterialsDrawer(s => s.update)
  const state = useRailState(taskId)
  const restoring = useRef<number | null>(null)
  // 브라우저가 짧은 로딩 콘텐츠에 맞춰 자른 위치로 저장값을 덮지 않는다.
  // 콘텐츠가 충분히 늘어나거나 사용자가 직접 스크롤할 때까지 복원 목표를 유지한다.
  useLayoutEffect(() => {
    const node = ref.current
    if (!visible || !active || !node) return
    restoring.current = state.scroll[tab] ?? 0
    const restore = () => {
      const top = restoring.current
      if (top === null) return
      node.scrollTop = top
      if (node.scrollTop === top) restoring.current = null
    }
    restore()
    const observer = new ResizeObserver(restore)
    if (node.firstElementChild) observer.observe(node.firstElementChild)
    return () => observer.disconnect()
  }, [visible, active, taskId, tab])
  const userScroll = () => { restoring.current = null }
  return <div ref={ref} id={id} role="tabpanel" aria-labelledby={labelledBy} hidden={!visible} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto p-3"
    onWheel={userScroll} onTouchStart={userScroll} onPointerDown={userScroll}
    onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) userScroll() }}
    onScroll={event => { if (visible && active && restoring.current === null && event.currentTarget.scrollTop !== state.scroll[tab]) update(taskId, { scroll: { ...state.scroll, [tab]: event.currentTarget.scrollTop } }) }}><div>{children}</div></div>
}
