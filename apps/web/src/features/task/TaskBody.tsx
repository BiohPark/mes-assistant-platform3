import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, History, ListChecks, MessageSquare, StickyNote } from 'lucide-react'
import type { Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { getActivity } from '@/api/tasks'
import { ChatView } from '@/features/chat/ChatView'
import { ModelPicker } from '@/features/chat/ModelPicker'
import { cn } from '@/lib/utils'
import { useTablistKeys } from '@/lib/useTablistKeys'
import { useT, type TranslationKey } from '@/i18n'
import { ActivityPanel } from './ActivityPanel'
import { MaterialsPanel } from './MaterialsPanel'
import { ChecklistPanel } from './ChecklistPanel'
import { NotesPanel } from './NotesPanel'

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

/** 채팅은 한 번만 마운트해 화면 폭이나 탭 변경 중 전송 상태를 유지한다. */
export function TaskBody({ task, assistant }: { task: Task; assistant: Assistant }) {
  const t = useT()
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat')
  const [panel, setPanel] = useState<Panel>('history')
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
  const selectMobileTab = (value: MobileTab) => { setMobileTab(value); if (value !== 'chat') setPanel(value) }
  const mobileKeys = useTablistKeys(mobileValues, mobileTab, selectMobileTab)
  const panelKeys = useTablistKeys(panelValues, panel, setPanel)
  return <div className="flex min-h-0 flex-1 flex-col">
    <div ref={mobileTabsRef} role="tablist" aria-label={t('task.body.tabs')} className="flex overflow-x-auto border-b px-3 py-2 lg:hidden" {...mobileKeys.tablistProps}>
      <button type="button" {...mobileKeys.tabProps('chat')} onClick={() => selectMobileTab('chat')} className={cn('inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs', mobileTab === 'chat' && 'bg-muted font-medium')}><MessageSquare className="size-4" />{t('task.conversation')}</button>
      {panels.map(({ value, label, icon: Icon }) => <button key={value} type="button" {...mobileKeys.tabProps(value)} onClick={() => selectMobileTab(value)} className={cn('inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs', mobileTab === value && 'bg-muted font-medium')}><Icon className="size-4" />{t(label)}</button>)}
    </div>
    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className={cn('min-h-0 flex-col', mobileTab === 'chat' ? 'flex' : 'hidden', 'lg:flex')} aria-label={t('task.conversation')}><div className="flex items-center border-b px-4 py-2"><ModelPicker task={task} assistant={assistant} disabled={task.status === 'done'} /></div><ChatView task={task} assistant={assistant} onOpenMaterials={() => { setPanel('materials'); setMobileTab('materials'); setFocusMaterials(true) }} /></section>
      <aside className={cn('min-h-0 overflow-hidden p-3 lg:border-l', mobileTab === 'chat' ? 'hidden' : 'flex flex-col', 'lg:flex lg:flex-col')} aria-label={t('task.body.panel')}>
        <div ref={panelTabsRef} role="tablist" aria-label={t('task.body.panelTabs')} className="hidden w-full border-b pb-2 lg:flex" {...panelKeys.tablistProps}>{panels.map(({ value, label, icon: Icon }) => <button key={value} type="button" id={`task-tab-${value}`} aria-controls="task-panel" {...panelKeys.tabProps(value)} onClick={() => setPanel(value)} className={cn('flex flex-1 items-center justify-center gap-1 rounded-lg py-1 text-xs', panel === value && 'bg-muted font-medium')}><Icon className="size-4" />{t(label)}</button>)}</div>
        <div role="tabpanel" id="task-panel" aria-labelledby={`task-tab-${panel}`} className="min-h-0 flex-1 overflow-y-auto pt-3">{panel === 'history' ? activity.isError ? <div role="alert" className="text-xs">{t('task.activity.loadFailed')} <button type="button" className="underline" onClick={() => void activity.refetch()}>{t('common.retry')}</button></div> : <ActivityPanel activity={activity.data ?? []} /> : panel === 'materials' ? <MaterialsPanel task={task} /> : panel === 'checklist' ? <ChecklistPanel task={task} /> : <NotesPanel task={task} />}</div>
      </aside>
    </div>
  </div>
}
