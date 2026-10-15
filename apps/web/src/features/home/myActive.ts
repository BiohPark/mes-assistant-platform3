import type { ID, TaskSummary } from '@mes/domain'

export const isAiResponding = (task: Pick<TaskSummary, 'aiRequest'>) => task.aiRequest?.status === 'pending' || task.aiRequest?.status === 'streaming'

/** 허브 '내 진행 중 대화'와 대화 화면의 빠른 전환이 같은 판정을 쓴다: 내 담당·참여 + in_progress, AI 응답 중 먼저, 그다음 최근 활동순 */
export function selectMyActive<T extends Pick<TaskSummary, 'status' | 'ownerId' | 'assigneeIds' | 'aiRequest' | 'lastActivityAt'>>(tasks: T[], userId: ID, limit: number): T[] {
  return tasks
    .filter(task => task.status === 'in_progress' && (task.ownerId === userId || task.assigneeIds.includes(userId)))
    .sort((a, b) => Number(isAiResponding(b)) - Number(isAiResponding(a)) || b.lastActivityAt.localeCompare(a.lastActivityAt))
    .slice(0, limit)
}
