import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router'
import { getTask } from '@/api/tasks'
import { TopBar } from '@/app/TopBar'
import { listAssistants } from '@/lib/catalog'
import { TaskHeader } from './TaskHeader'
import { TaskBody } from './TaskBody'

export function TaskPage() {
  const { taskId } = useParams()
  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => getTask(taskId!), enabled: !!taskId, retry: false })
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const assistant = assistants.data?.find((item) => item.id === task.data?.assistantId)
  if (task.isError) return <Navigate to="/" replace />
  if (!task.data || !assistant) return <><TopBar title="대화" /><div className="p-6 text-sm text-muted-foreground">불러오는 중…</div></>
  return <><TopBar title={`${task.data.code} · ${task.data.title}`} /><TaskHeader task={task.data} assistant={assistant} /><TaskBody task={task.data} assistant={assistant} /></>
}

export function LegacyTaskRedirect() {
  const { taskId } = useParams()
  return <Navigate to={`/c/${taskId ?? ''}`} replace />
}
