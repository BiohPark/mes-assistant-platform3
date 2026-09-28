import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, History, ListChecks, MessageSquare, StickyNote } from 'lucide-react'
import type { Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { getActivity } from '@/api/tasks'
import { ChatView } from '@/features/chat/ChatView'
import { ModelPicker } from '@/features/chat/ModelPicker'
import { cn } from '@/lib/utils'
import { ActivityPanel } from './ActivityPanel'

type Panel = 'materials' | 'checklist' | 'notes' | 'history'
type MobileTab = 'chat' | Panel
const panels: { value: Panel; label: string; icon: typeof FileText }[] = [
  { value: 'materials', label: '자료', icon: FileText },
  { value: 'checklist', label: '체크', icon: ListChecks },
  { value: 'notes', label: '노트', icon: StickyNote },
  { value: 'history', label: '이력', icon: History },
]

/** 채팅은 한 번만 마운트해 화면 폭이나 탭 변경 중 전송 상태를 유지한다. */
export function TaskBody({ task, assistant }: { task: Task; assistant: Assistant }) {
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat')
  const [panel, setPanel] = useState<Panel>('history')
  const activity = useQuery({ queryKey: ['activity', task.id], queryFn: () => getActivity(task.id) })
  return <div className="flex min-h-0 flex-1 flex-col">
    <div role="tablist" aria-label="대화 화면 탭" className="flex overflow-x-auto border-b px-3 py-2 lg:hidden">
      <button type="button" role="tab" aria-selected={mobileTab === 'chat'} onClick={() => setMobileTab('chat')} className={cn('inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs', mobileTab === 'chat' && 'bg-muted font-medium')}><MessageSquare className="size-4" />대화</button>
      {panels.map(({ value, label, icon: Icon }) => <button key={value} type="button" role="tab" aria-selected={mobileTab === value} onClick={() => { setMobileTab(value); setPanel(value) }} className={cn('inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs', mobileTab === value && 'bg-muted font-medium')}><Icon className="size-4" />{label}</button>)}
    </div>
    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className={cn('min-h-0 flex-col', mobileTab === 'chat' ? 'flex' : 'hidden', 'lg:flex')} aria-label="대화"><div className="flex items-center border-b px-4 py-2"><ModelPicker task={task} assistant={assistant} disabled={task.status === 'done'} /></div><ChatView task={task} /></section>
      <aside className={cn('min-h-0 overflow-hidden p-3 lg:border-l', mobileTab === 'chat' ? 'hidden' : 'flex flex-col', 'lg:flex lg:flex-col')} aria-label="대화 보조 패널">
        <div role="tablist" aria-label="보조 패널" className="hidden w-full border-b pb-2 lg:flex">{panels.map(({ value, label, icon: Icon }) => <button key={value} type="button" role="tab" aria-selected={panel === value} onClick={() => setPanel(value)} className={cn('flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-xs', panel === value && 'bg-muted font-medium')}><Icon className="size-4" />{label}</button>)}</div>
        <div className="min-h-0 flex-1 overflow-y-auto pt-3">{panel === 'history' ? activity.isError ? <div role="alert" className="text-xs">이력을 불러오지 못했습니다. <button type="button" className="underline" onClick={() => void activity.refetch()}>다시 시도</button></div> : <ActivityPanel activity={activity.data ?? []} /> : <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">{panels.find((item) => item.value === panel)?.label}는 후속 단계에서 사용할 수 있습니다.</div>}</div>
      </aside>
    </div>
  </div>
}
