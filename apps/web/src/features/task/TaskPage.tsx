import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { appendMessage, getTask } from '@/api/tasks'
import { useActor } from '@/app/hooks'
import { TopBar } from '@/app/TopBar'
import { listAssistants } from '@/lib/catalog'
import { TaskHeader } from './TaskHeader'
import { TaskBody } from './TaskBody'

const sentHandoffs = new Set<string>()

export function TaskPage() {
  const { taskId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const actor = useActor()
  const queryClient = useQueryClient()
  const sent = useRef(false)
  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => getTask(taskId!), enabled: !!taskId, retry: false })
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const assistant = assistants.data?.find((item) => item.id === task.data?.assistantId)
  const handoff = (location.state as { autoSend?: string } | null)?.autoSend

  useEffect(() => {
    if (!handoff || !task.data?.threadId || sent.current || sentHandoffs.has(task.data.id)) return
    sent.current = true
    sentHandoffs.add(task.data.id)
    void appendMessage(actor, task.data.threadId, 'user', handoff, [], 'done', 'discussion').then(async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages', task.data!.threadId] })
      navigate(location.pathname, { replace: true, state: null })
    }).catch((error: unknown) => { sent.current = false; sentHandoffs.delete(task.data!.id); toast.error(error instanceof Error ? error.message : '첫 의견을 전송하지 못했습니다') })
  }, [actor.userId, handoff, location.pathname, navigate, queryClient, task.data])

  if (task.isError) return <Navigate to="/" replace />
  if (!task.data || !assistant) return <><TopBar title="대화" /><div className="p-6 text-sm text-muted-foreground">불러오는 중…</div></>
  return <><TopBar title={`${task.data.code} · ${task.data.title}`} /><TaskHeader task={task.data} assistant={assistant} /><TaskBody task={task.data} assistant={assistant} /></>
}

export function LegacyTaskRedirect() {
  const { taskId } = useParams()
  return <Navigate to={`/c/${taskId ?? ''}`} replace />
}
