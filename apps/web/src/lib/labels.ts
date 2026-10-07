import type { ActivityType, AssistantStatus, ModelSource, Priority, SrStatus, TaskStatus } from '@mes/domain'
import type { TranslationKey } from '@/i18n'

export const TASK_STATUS_KEY = {
  todo: 'status.task.todo',
  in_progress: 'status.task.in_progress',
  on_hold: 'status.task.on_hold',
  done: 'status.task.done',
} as const satisfies Record<TaskStatus, TranslationKey>

export const ASSISTANT_STATUS_KEY = {
  open: 'status.assistant.open',
  developing: 'status.assistant.developing',
  testing: 'status.assistant.testing',
  retired: 'status.assistant.retired',
} as const satisfies Record<AssistantStatus, TranslationKey>

export const SR_STATUS_KEY = {
  draft: 'status.sr.draft',
  submitted: 'status.sr.submitted',
  reviewing: 'status.sr.reviewing',
  in_progress: 'status.sr.in_progress',
  responded: 'status.sr.responded',
  done: 'status.sr.done',
  rejected: 'status.sr.rejected',
} as const satisfies Record<SrStatus, TranslationKey>

export const PRIORITY_KEY = {
  low: 'status.priority.low',
  normal: 'status.priority.normal',
  high: 'status.priority.high',
  urgent: 'status.priority.urgent',
} as const satisfies Record<Priority, TranslationKey>

export const PRIORITY_CLASS: Record<Priority, string> = {
  low: 'bg-tone-neutral-bg text-tone-neutral-fg',
  normal: 'bg-tone-info-bg text-tone-info-fg',
  high: 'bg-tone-warning-bg text-tone-warning-fg',
  urgent: 'bg-tone-danger-bg text-tone-danger-fg',
}

export const ACTIVITY_KEY = {
  'task.created': 'status.activity.task.created',
  'task.started': 'status.activity.task.started',
  'task.completed': 'status.activity.task.completed',
  'task.reopened': 'status.activity.task.reopened',
  'task.hold': 'status.activity.task.hold',
  'task.status_changed': 'status.activity.task.status_changed',
  'checklist.checked': 'status.activity.checklist.checked',
  'checklist.unchecked': 'status.activity.checklist.unchecked',
  'checklist.reviewed': 'status.activity.checklist.reviewed',
  'file.uploaded': 'status.activity.file.uploaded',
  'file.tagged_output': 'status.activity.file.tagged_output',
  'input.selected': 'status.activity.input.selected',
  'input.removed': 'status.activity.input.removed',
  'context.selected': 'status.activity.context.selected',
  'context.removed': 'status.activity.context.removed',
  'context.refreshed': 'status.activity.context.refreshed',
  'note.added': 'status.activity.note.added',
  'message.sent': 'status.activity.message.sent',
  'thread.created': 'status.activity.thread.created',
  'model.changed': 'status.activity.model.changed',
  'feedback.given': 'status.activity.feedback.given',
  'tag.added': 'status.activity.tag.added',
  'tag.removed': 'status.activity.tag.removed',
  'assistant.created': 'status.activity.assistant.created',
  'assistant.updated': 'status.activity.assistant.updated',
  'assistant.status_changed': 'status.activity.assistant.status_changed',
  'assistant.reordered': 'status.activity.assistant.reordered',
  'sr.created': 'status.activity.sr.created',
  'sr.submitted': 'status.activity.sr.submitted',
  'sr.status_changed': 'status.activity.sr.status_changed',
  'sr.task_started': 'status.activity.sr.task_started',
  'sr.result_shared': 'status.activity.sr.result_shared',
} as const satisfies Record<ActivityType, TranslationKey>

export const MODEL_SOURCE_KEY = {
  thread: 'common.modelSource.thread',
  task: 'common.modelSource.task',
  assistant: 'common.modelSource.assistant',
  settings: 'common.modelSource.settings',
} as const satisfies Record<ModelSource, TranslationKey>
