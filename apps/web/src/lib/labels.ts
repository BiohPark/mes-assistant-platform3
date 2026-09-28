import type { ActivityType, AssistantStatus, Priority, SrStatus, TaskStatus } from '@mes/domain'

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '대기',
  in_progress: '진행 중',
  on_hold: '보류',
  done: '완료',
}

export const ASSISTANT_STATUS_LABEL: Record<AssistantStatus, string> = {
  open: '오픈',
  developing: '개발 중',
  testing: '테스트',
  retired: '폐기',
}

export const SR_STATUS_LABEL: Record<SrStatus, string> = {
  draft: '대화 중',
  submitted: '접수됨',
  reviewing: '검토 중',
  in_progress: '진행 중',
  responded: '답변 공유',
  done: '완료',
  rejected: '반려',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: '낮음',
  normal: '보통',
  high: '높음',
  urgent: '긴급',
}

export const PRIORITY_CLASS: Record<Priority, string> = {
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  normal: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  high: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  urgent: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
}

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  'task.created': '대화 시작',
  'task.started': '업무 시작',
  'task.completed': '업무 완료',
  'task.reopened': '업무 재개',
  'task.hold': '업무 보류',
  'task.status_changed': '상태 변경',
  'checklist.checked': '체크리스트 완료',
  'checklist.unchecked': '체크리스트 해제',
  'checklist.reviewed': 'AI 달성도 점검',
  'file.uploaded': '파일 업로드',
  'file.tagged_output': '산출물 저장',
  'input.selected': '입력 선택',
  'input.removed': '입력 해제',
  'context.selected': '참조 대화 선택',
  'context.removed': '참조 대화 해제',
  'context.refreshed': '참조 대화 갱신',
  'note.added': '메모 작성',
  'message.sent': '메시지 전송',
  'thread.created': '스레드 생성',
  'model.changed': '모델 변경',
  'feedback.given': 'assistant 피드백',
  'tag.added': '태그 추가',
  'tag.removed': '태그 제거',
  'assistant.created': '에이전트 등록',
  'assistant.updated': '에이전트 수정',
  'assistant.status_changed': '에이전트 상태 변경',
  'assistant.reordered': '에이전트 순서 변경',
  'sr.created': 'SR 대화 시작',
  'sr.submitted': 'SR 접수',
  'sr.status_changed': 'SR 상태 변경',
  'sr.task_started': 'SR 연결 업무 시작',
  'sr.result_shared': 'SR 결과 공유',
}
