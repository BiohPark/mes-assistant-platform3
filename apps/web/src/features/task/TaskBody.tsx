import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, History, ListChecks, MessageSquare, StickyNote } from 'lucide-react'
import type { Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { getActivity } from '@/api/tasks'
import { ChatView } from '@/features/chat/ChatView'
import { cn } from '@/lib/utils'
import { useTablistKeys } from '@/lib/useTablistKeys'
import { useT, type TranslationKey } from '@/i18n'
import { ActivityPanel } from './ActivityPanel'
import { MaterialsPanel } from './MaterialsPanel'
import { ChecklistPanel } from './ChecklistPanel'
import { NotesPanel } from './NotesPanel'
import { useTagShareStore } from './tagShare'

type Panel = 'materials' | 'checklist' | 'notes' | 'history'
type MobileTab = 'chat' | Panel
const panels: { value: Panel; label: Extract<TranslationKey, `task.body.${string}`>; icon: typeof FileText }[] = [
  { value: 'materials', label: 'task.body.materials', icon: FileText },
  { value: 'checklist', label: 'task.body.checklist', icon: ListChecks },
  { value: 'notes', label: 'task.body.notes', icon: StickyNote },
  { value: 'history', label: 'task.body.history', icon: History },
]
const panelValues = panels.map(({ value }) => value)
const mobileValues: MobileTab[] = ['chat', ...panelValues]

/** 채팅은 대화당 한 번만 마운트해 화면 폭이나 탭 변경 중 전송 상태를 유지한다. 다른 대화로 전환하면 key로 격리한다(초안은 Composer가 taskId로 보존). headerTools는 헤더의 검색·질문 목차 자리 */
export function TaskBody({ task, assistant, headerTools }: { task: Task; assistant: Assistant; headerTools?: HTMLElement | null }) {
  const t = useT()
  const ids = useId() // 여러 대화를 탭으로 함께 살려 두므로(S15) 보조 패널 탭·패널 id는 인스턴스마다 고유하게
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat')
  const [panel, setPanel] = useState<Panel>('materials')
  const [focusMaterials, setFocusMaterials] = useState(false)
  const mobileTabsRef = useRef<HTMLDivElement>(null)
  const panelTabsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusMaterials) return
    const tabs = mobileTabsRef.current && getComputedStyle(mobileTabsRef.current).display !== 'none' ? mobileTabsRef.current : panelTabsRef.current
    tabs?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus()
    setFocusMaterials(false)
  }, [focusMaterials])
  const activity = useQuery({ queryKey: ['activity', task.id], queryFn: () => getActivity(task.id) })
  // 태그 공유 말풍선을 누르면 자료 탭으로 — 들어오고 빠진 표시가 거기 있다
  const openSeq = useTagShareStore((state) => state.openSeq[task.id] ?? 0)
  useEffect(() => { if (openSeq) { setPanel('materials'); setMobileTab('materials') } }, [openSeq])
  // 좁은 화면에서 대화 탭이 아니면 헤더의 검색·질문 목차 아이콘을 숨긴다 — 분기점(lg)은 TaskHeader의 CSS가 맡으므로 데스크톱은 영향 없음
  useEffect(() => { if (headerTools) headerTools.dataset.chatHidden = String(mobileTab !== 'chat') }, [headerTools, mobileTab])
  const selectMobileTab = (value: MobileTab) => { setMobileTab(value); if (value !== 'chat') setPanel(value) }
  const mobileKeys = useTablistKeys(mobileValues, mobileTab, selectMobileTab)
  const panelKeys = useTablistKeys(panelValues, panel, setPanel)
  return <div className="flex min-h-0 flex-1 flex-col">
    <div ref={mobileTabsRef} role="tablist" aria-label={t('task.body.tabs')} data-tour="task-tabs" className="flex overflow-x-auto border-b px-3 py-2 lg:hidden" {...mobileKeys.tablistProps}>
      <button type="button" {...mobileKeys.tabProps('chat')} onClick={() => selectMobileTab('chat')} className={cn('inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs', mobileTab === 'chat' && 'bg-muted font-medium')}><MessageSquare className="size-4" />{t('task.conversation')}</button>
      {panels.map(({ value, label, icon: Icon }) => <button key={value} type="button" {...mobileKeys.tabProps(value)} onClick={() => selectMobileTab(value)} className={cn('inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs', mobileTab === value && 'bg-muted font-medium')}><Icon className="size-4" />{t(label)}</button>)}
    </div>
    {/* 좁은 화면도 minmax(0,1fr) — auto 열이면 입력창 아래 줄(모델 pill)의 최소 폭만큼 문서가 가로로 넘친다 */}
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className={cn('min-h-0 flex-col', mobileTab === 'chat' ? 'flex' : 'hidden', 'lg:flex')} aria-label={t('task.conversation')}><ChatView key={task.id} task={task} assistant={assistant} headerTools={headerTools} onOpenMaterials={() => { setPanel('materials'); setMobileTab('materials'); setFocusMaterials(true) }} /></section>
      <aside className={cn('min-h-0 overflow-hidden p-3 lg:border-l', mobileTab === 'chat' ? 'hidden' : 'flex flex-col', 'lg:flex lg:flex-col')} aria-label={t('task.body.panel')}>
        <div ref={panelTabsRef} role="tablist" aria-label={t('task.body.panelTabs')} data-tour="task-tabs" className="hidden w-full border-b pb-2 lg:flex" {...panelKeys.tablistProps}>{panels.map(({ value, label, icon: Icon }) => <button key={value} type="button" id={`task-tab-${ids}-${value}`} aria-controls={`task-panel-${ids}`} {...panelKeys.tabProps(value)} onClick={() => setPanel(value)} className={cn('flex flex-1 items-center justify-center gap-1 rounded-lg py-1 text-xs', panel === value && 'bg-muted font-medium')}><Icon className="size-4" />{t(label)}</button>)}</div>
        <div role="tabpanel" id={`task-panel-${ids}`} aria-labelledby={`task-tab-${ids}-${panel}`} className="min-h-0 flex-1 overflow-y-auto pt-3">{panel === 'history' ? activity.isError ? <div role="alert" className="text-xs">{t('task.activity.loadFailed')} <button type="button" className="underline" onClick={() => void activity.refetch()}>{t('common.retry')}</button></div> : <ActivityPanel activity={activity.data ?? []} /> : panel === 'materials' ? <MaterialsPanel task={task} /> : panel === 'checklist' ? <ChecklistPanel task={task} /> : <NotesPanel task={task} />}</div>
      </aside>
    </div>
  </div>
}
