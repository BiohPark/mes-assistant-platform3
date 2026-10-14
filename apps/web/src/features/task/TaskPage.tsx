import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router'
import { getTask } from '@/api/tasks'
import { TopBar } from '@/app/TopBar'
import { listAssistants } from '@/lib/catalog'
import { TaskHeader } from './TaskHeader'
import { TaskTitle } from './TaskTitle'
import { TaskBody } from './TaskBody'
import { useT } from '@/i18n'

export function TaskPage() {
  const t = useT()
  const { taskId } = useParams()
  // 헤더 둘째 줄의 도구 자리 — ChatView가 검색·질문 목차 아이콘을 여기로 포털한다
  const [headerTools, setHeaderTools] = useState<HTMLDivElement | null>(null)
  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => getTask(taskId!), enabled: !!taskId, retry: false })
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const assistant = assistants.data?.find((item) => item.id === task.data?.assistantId)
  if (task.isError) return <Navigate to="/" replace />
  if (!task.data || !assistant) return <><TopBar title={t('task.conversation')} /><div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div></>
  return <><TopBar title={<TaskTitle key={task.data.id} task={task.data} />} /><TaskHeader task={task.data} assistant={assistant} toolsRef={setHeaderTools} /><TaskBody task={task.data} assistant={assistant} headerTools={headerTools} /></>
}

export function LegacyTaskRedirect() {
  const { taskId } = useParams()
  return <Navigate to={`/c/${taskId ?? ''}`} replace />
}
