import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { getActivity } from '@/api/tasks'
import { ChatView } from '@/features/chat/ChatView'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { ActivityPanel } from './ActivityPanel'
import { MaterialsPanel } from './MaterialsPanel'
import { ChecklistPanel } from './ChecklistPanel'
import { NotesPanel } from './NotesPanel'
import { useTagShareStore } from './tagShare'
import { drawerId, useDrawerBar, useDrawerOpen, useMaterialsDrawer } from './materialsDrawer'

type TaskBodyProps = { task: Task; assistant: Assistant; headerTools?: HTMLElement | null }

/** 접기에는 인스턴스를 유지하고 대화 전환에는 로컬 작성·검토 상태를 분리한다. */
export function TaskBody(props: TaskBodyProps) {
  return <ConversationBody key={props.task.id} {...props} />
}

function ConversationBody({ task, assistant, headerTools }: TaskBodyProps) {
  const t = useT()
  const ids = useId()
  const open = useDrawerOpen(task)
  const bar = useDrawerBar(task)
  const [visited, setVisited] = useState(open)
  useEffect(() => { if (open) setVisited(true) }, [open])
  const state = useMaterialsDrawer(s => s.byTask[task.id])
  const choose = useMaterialsDrawer(s => s.choose)
  const [toolsOpen, setToolsOpen] = useState(false)
  const lastFocus = useRef(state?.focusSeq ?? 0)
  const aside = useRef<HTMLElement>(null)
  const tools = useRef<HTMLDetailsElement>(null)
  const syncContext = useMaterialsDrawer(s => s.syncContext)
  useEffect(() => { syncContext(task) }, [task.id, task.tags, task.linkedSrCodes, syncContext])
  useEffect(() => {
    if (!open || !state?.focusSeq || state.focusSeq === lastFocus.current) return
    if (state.tool && !toolsOpen) { setToolsOpen(true); return }
    lastFocus.current = state.focusSeq
    // Radix 메뉴의 포커스 트랩이 해제된 다음 프레임에 페이지 영역으로 옮긴다.
    const frame = requestAnimationFrame(() => {
      const target = state.tool ? tools.current?.querySelector<HTMLElement>(`[data-work-tool="${state.tool}"]`) : aside.current
      target?.focus()
      if (state.tool) target?.scrollIntoView?.({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, state?.focusSeq, state?.tool, toolsOpen])
  const activity = useQuery({ queryKey: ['activity', task.id], queryFn: () => getActivity(task.id), enabled: open && toolsOpen })
  const openSeq = useTagShareStore(s => s.openSeq[task.id] ?? 0)
  useEffect(() => { if (useTagShareStore.getState().consumeOpen(task.id, openSeq)) choose(task.id, 'open', undefined, true) }, [openSeq, task.id, choose])
  return <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)]" data-testid="task-body">
    <div className={cn('flex min-h-0 min-w-0', (open || bar) && 'max-lg:flex-col')}>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t('task.conversation')}><ChatView key={task.id} task={task} assistant={assistant} headerTools={headerTools} onOpenMaterials={() => choose(task.id, 'open', undefined, true)} /></section>
      <aside hidden={!open && !bar} ref={aside} id={drawerId(task.id)} tabIndex={-1} className={cn('min-h-0 overflow-y-auto border-t p-3 lg:w-[360px] lg:shrink-0 lg:border-t-0 lg:border-l', open && 'max-lg:max-h-[50%]')} aria-label={t('task.materials.linkedLibrary')}>
        <details open={open}>
          <summary className="cursor-pointer text-sm font-medium lg:hidden" onClick={event => { event.preventDefault(); choose(task.id, open ? 'closed' : 'open') }}>{t('task.materials.linkedLibrary')}</summary>
          {(open || visited) && <>
            <MaterialsPanel task={task} embedded />
            <details ref={tools} tabIndex={-1} open={toolsOpen} onToggle={event => setToolsOpen(event.currentTarget.open)} className="mt-3 shrink-0 border-t pt-3" data-tour="work-tools">
              <summary className="cursor-pointer text-xs font-medium">{t('task.body.tools')}</summary>
              <div className="space-y-4 pt-3">
                <section data-work-tool="checklist" tabIndex={-1} id={`task-checklist-${ids}`} aria-label={t('task.body.checklist')}><ChecklistPanel task={task} /></section>
                <section data-work-tool="notes" tabIndex={-1} id={`task-notes-${ids}`} aria-label={t('task.body.notes')}><NotesPanel task={task} /></section>
                <section data-work-tool="history" tabIndex={-1} id={`task-history-${ids}`} aria-label={t('task.body.history')}><h3 className="mb-2 text-sm font-medium">{t('task.body.history')}</h3>{activity.isError ? <div role="alert" className="text-xs">{t('task.activity.loadFailed')} <button type="button" className="underline" onClick={() => void activity.refetch()}>{t('common.retry')}</button></div> : <ActivityPanel activity={activity.data ?? []} />}</section>
              </div>
            </details>
          </>}
        </details>
      </aside>
    </div>
  </div>
}
