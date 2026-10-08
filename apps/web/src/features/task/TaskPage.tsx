import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router'
import { getTask } from '@/api/tasks'
import { TopBar } from '@/app/TopBar'
import { listAssistants } from '@/lib/catalog'
import { TaskHeader } from './TaskHeader'
import { TaskBody } from './TaskBody'
import { useT } from '@/i18n'

export function TaskPage() {
  const t = useT()
  const { taskId } = useParams()
  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => getTask(taskId!), enabled: !!taskId, retry: false })
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const assistant = assistants.data?.find((item) => item.id === task.data?.assistantId)
  if (task.isError) return <Navigate to="/" replace />
  if (!task.data || !assistant) return <><TopBar title={t('task.conversation')} /><div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div></>
  return <><TopBar title={`${task.data.code} · ${task.data.title}`} /><TaskHeader task={task.data} assistant={assistant} /><TaskBody task={task.data} assistant={assistant} /></>
}

export function LegacyTaskRedirect() {
  const { taskId } = useParams()
  return <Navigate to={`/c/${taskId ?? ''}`} replace />
}
