import type { Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { ChatView } from '@/features/chat/ChatView'
import { TaskRail } from './TaskRail'

type TaskBodyProps = { task: Task; assistant: Assistant; headerTools?: HTMLElement | null }

export function TaskBody({ task, assistant, headerTools }: TaskBodyProps) {
  return <TaskRail key={task.id} task={task}>
    <ChatView key={task.id} task={task} assistant={assistant} headerTools={headerTools} />
  </TaskRail>
}
