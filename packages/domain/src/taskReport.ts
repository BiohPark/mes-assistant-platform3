import { durationDays, formatDate } from './lib/dates.js'
import type { Assistant, FileAsset, ID, Task, TaskInput } from './types.js'

export interface TaskReportInput {
  task: Task
  assistant: Pick<Assistant, 'name' | 'level1' | 'level2' | 'classifications'>
  files: Pick<FileAsset, 'id' | 'name'>[]
  /** 선택한 입력 (출처 대화의 어시스턴트 이름 포함) */
  inputs: Array<{ name: string; version: number; weight: TaskInput['weight']; fromAssistantName: string }>
  users: Map<ID, { name: string }>
  now?: Date
  /** 필수 체크 항목이 미완료인 채 완료할 때의 사유 */
  completionReason?: string
}

const NONE = '- (없음)'

function list<T>(items: T[], render: (item: T) => string): string {
  return items.length ? items.map(render).join('\n') : NONE
}

/** 업무 완료 리포트 (markdown). 파일함에 산출물로 저장된다. */
export function buildTaskReport({ task, assistant, files, inputs, users, now = new Date(), completionReason }: TaskReportInput): string {
  const fileById = new Map(files.map((f) => [f.id, f]))
  const lead = durationDays(task.startedAt ?? task.createdAt, task.completedAt, now)
  const outputs = task.outputFileIds.map((id) => fileById.get(id)).filter((f): f is Pick<FileAsset, 'id' | 'name'> => !!f)
  const feedback = task.feedback
  const feedbackBy = feedback ? (users.get(feedback.by)?.name ?? feedback.by) : ''

  return [
    `# 업무 완료 리포트 — ${task.code} ${task.title}`,
    '',
    `- 어시스턴트: ${assistant.name} (${(assistant.classifications ?? [assistant]).map(path => `${path.level1} > ${path.level2}`).join(', ')})`,
    `- 기간: ${formatDate(task.startedAt ?? task.createdAt)} ~ ${formatDate(task.completedAt)} · 리드타임: ${lead ?? 0}일`,
    `- 요약: ${task.summary || '(없음)'}`,
    `- 태그: ${task.tags.length ? task.tags.join(', ') : '(없음)'}`,
    '',
    '## 체크리스트',
    list(task.checklist, (c) => `- [${c.checked ? 'x' : ' '}] ${c.label}${c.required ? ' (중요)' : ''}`),
    ...(task.checklistReview ? [`- AI 달성도: ${task.checklistReview.met}/${task.checklistReview.total} (${formatDate(task.checklistReview.at, 'yyyy-MM-dd HH:mm')})`] : []),
    ...(completionReason ? [`- 필수 항목 미완료 완료 사유: ${completionReason}`] : []),
    '',
    '## 산출물',
    list(outputs, (f) => `- ${f.name}`),
    '',
    '## 입력 자료',
    list(inputs, (i) => `- ${i.weight === 'main' ? '[주 입력] ' : '[참고] '}${i.name} v${i.version} ← ${i.fromAssistantName}`),
    '',
    '## assistant 피드백',
    feedback ? `- ★ ${feedback.rating} — ${feedback.comment || '(코멘트 없음)'} (${feedbackBy})` : NONE,
    '',
    `_생성: ${formatDate(now.toISOString(), 'yyyy-MM-dd HH:mm')}_`,
  ].join('\n')
}
