import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Task } from '@mes/domain'
import { setTaskTitle } from '@/api/tasks'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'

/** 대화 헤더의 제목 한 줄. 누르면 그 자리에서 고친다(완료된 업무는 잠금). 코드는 더 보기 메뉴에 둔다 */
export function TaskTitle({ task }: { task: Task }) {
  const t = useT()
  const query = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const saving = useRef(false)

  async function commit() {
    if (saving.current) return
    saving.current = true
    setEditing(false)
    const next = title.trim()
    if (next && next !== task.title) {
      try {
        await setTaskTitle(task.id, next, 'manual')
        void query.invalidateQueries({ queryKey: ['task', task.id] })
        void query.invalidateQueries({ queryKey: ['tasks'] })
      } catch (error) { toast.error(error instanceof Error ? error.message : t('task.header.titleSaveFailed')) }
    } else setTitle(task.title)
    saving.current = false
  }

  if (editing) return <Input aria-label={t('task.header.titleLabel')} value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => void commit()} onKeyDown={(event) => { if (event.key === 'Enter') void commit(); if (event.key === 'Escape') { setTitle(task.title); setEditing(false) } }} autoFocus className="h-8 max-w-xl text-base font-semibold" />
  return <button type="button" className="flex max-w-full items-baseline gap-1.5 truncate text-left hover:underline disabled:no-underline" disabled={task.status === 'done'} title={t('task.header.titleLabel')} onClick={() => { setTitle(task.title); setEditing(true) }}>
<span className="truncate">{task.title}</span>
  </button>
}
