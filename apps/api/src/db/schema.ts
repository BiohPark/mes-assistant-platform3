// Drizzle 스키마 — docs/architecture/postgres-draft.sql 과 1:1 (schema-parity 테스트가 대조한다).
// 테이블·컬럼 순서도 초안을 따른다. 초안을 바꾸면 이 파일과 마이그레이션을 함께 바꾼다.
import { sql, type AnyColumn } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

const tz = (name: string) => timestamp(name, { withTimezone: true })
const inList = (col: AnyColumn, values: string[]) =>
  sql`${col} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`

// ── 사람·에이전트 ─────────────────────────────────────────────────────────
export const appUser = pgTable('app_user', {
  id: text('id').primaryKey(),
  ssoSubject: text('sso_subject').unique('app_user_sso_subject_key'),
  name: text('name').notNull(),
  role: text('role').notNull().default(''),
  initials: text('initials').notNull(),
  color: text('color').notNull(),
  isSystemOwner: boolean('is_system_owner').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: tz('created_at').notNull().defaultNow(),
})

export const fileObject = pgTable(
  'file_object',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    originTaskId: text('origin_task_id').references((): AnyPgColumn => task.id),
    originSrId: text('origin_sr_id').references((): AnyPgColumn => serviceRequest.id),
    originalName: text('original_name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    storageKey: text('storage_key').notNull().unique('file_object_storage_key_key'),
    source: text('source').notNull(),
    isOutput: boolean('is_output').notNull().default(false),
    version: integer('version').notNull(),
    previousId: text('previous_id').references((): AnyPgColumn => fileObject.id),
    uploadedBy: text('uploaded_by').notNull().references((): AnyPgColumn => appUser.id),
    uploadedAt: tz('uploaded_at').notNull().defaultNow(),
    deletedAt: tz('deleted_at'),
  },
  (t) => [
    check('file_object_kind_check', inList(t.kind, ['task_file', 'sr_attachment', 'assistant_image'])),
    check('file_object_source_check', inList(t.source, ['upload', 'assistant'])),
    check('file_object_version_check', sql`${t.version} >= 1`),
    check('file_object_check', sql`not ${t.isOutput} or ${t.kind} = 'task_file'`),
    check('file_object_check1', sql`(${t.kind} = 'sr_attachment') = (${t.originSrId} is not null)`),
    index('file_object_origin_task').on(t.originTaskId),
    index('file_object_origin_sr').on(t.originSrId),
    uniqueIndex('file_object_version')
      .on(sql`coalesce(${t.originTaskId}, ${t.originSrId})`, t.originalName, t.version)
      .where(sql`${t.deletedAt} is null`),
  ],
)

export const assistant = pgTable(
  'assistant',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    level1: text('level1').notNull(),
    level2: text('level2').notNull(),
    summary: text('summary').notNull().default(''),
    sortOrder: integer('sort_order').notNull(),
    modelId: text('model_id'),
    link1: text('link1'),
    docUrl: text('doc_url'),
    ownerId: text('owner_id').notNull().references((): AnyPgColumn => appUser.id),
    status: text('status').notNull(),
    usageExample: text('usage_example').notNull().default(''),
    imageFileId: text('image_file_id').references((): AnyPgColumn => fileObject.id),
    color: text('color').notNull(),
    revision: integer('revision').notNull().default(0),
    createdBy: text('created_by').notNull().references((): AnyPgColumn => appUser.id),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('assistant_status_check', inList(t.status, ['open', 'developing', 'testing', 'retired']))],
)

export const assistantExpectedIo = pgTable(
  'assistant_expected_io',
  {
    assistantId: text('assistant_id').notNull().references((): AnyPgColumn => assistant.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(),
    sortOrder: integer('sort_order').notNull(),
    label: text('label').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.assistantId, t.direction, t.sortOrder] }),
    check('assistant_expected_io_direction_check', inList(t.direction, ['input', 'output'])),
  ],
)

export const assistantChecklistTemplate = pgTable('assistant_checklist_template', {
  id: text('id').primaryKey(),
  assistantId: text('assistant_id').notNull().references((): AnyPgColumn => assistant.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
  label: text('label').notNull(),
  required: boolean('required').notNull().default(false),
})

// ── 대화(=업무)·스레드·메시지 ─────────────────────────────────────────────
export const task = pgTable(
  'task',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique('task_code_key'),
    assistantId: text('assistant_id').notNull().references((): AnyPgColumn => assistant.id),
    title: text('title').notNull(),
    titleSource: text('title_source').notNull(),
    summary: text('summary').notNull().default(''),
    status: text('status').notNull(),
    ownerId: text('owner_id').notNull().references((): AnyPgColumn => appUser.id),
    priority: text('priority').notNull(),
    dueDate: date('due_date'),
    modelId: text('model_id'),
    createdBy: text('created_by').notNull().references((): AnyPgColumn => appUser.id),
    createdAt: tz('created_at').notNull().defaultNow(),
    lastActivityAt: tz('last_activity_at').notNull().defaultNow(),
    startedAt: tz('started_at'),
    completedAt: tz('completed_at'),
    completedBy: text('completed_by').references((): AnyPgColumn => appUser.id),
  },
  (t) => [
    check('task_title_source_check', inList(t.titleSource, ['default', 'ai', 'manual'])),
    check('task_status_check', inList(t.status, ['todo', 'in_progress', 'on_hold', 'done'])),
    check('task_priority_check', inList(t.priority, ['low', 'normal', 'high', 'urgent'])),
    index('task_assistant').on(t.assistantId),
    index('task_last_activity').on(sql`${t.lastActivityAt} desc`),
  ],
)

export const taskAssignee = pgTable(
  'task_assignee',
  {
    taskId: text('task_id').notNull().references((): AnyPgColumn => task.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references((): AnyPgColumn => appUser.id),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] })],
)

export const tag = pgTable(
  'tag',
  {
    key: text('key').primaryKey(),
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [check('tag_kind_check', inList(t.kind, ['sr', 'keyword']))],
)

export const taskTag = pgTable(
  'task_tag',
  {
    taskId: text('task_id').notNull().references((): AnyPgColumn => task.id, { onDelete: 'cascade' }),
    tagKey: text('tag_key').notNull().references((): AnyPgColumn => tag.key),
    addedBy: text('added_by').notNull().references((): AnyPgColumn => appUser.id),
    addedAt: tz('added_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagKey] }), index('task_tag_by_tag').on(t.tagKey)],
)

export const serviceRequest = pgTable(
  'service_request',
  {
    id: text('id').primaryKey(),
    code: text('code').unique('service_request_code_key'),
    requesterId: text('requester_id').notNull().references((): AnyPgColumn => appUser.id),
    title: text('title').notNull().default(''),
    titleSource: text('title_source').notNull(),
    body: text('body').notNull().default(''),
    status: text('status').notNull(),
    submittedAt: tz('submitted_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('service_request_title_source_check', inList(t.titleSource, ['default', 'ai', 'manual'])),
    check(
      'service_request_status_check',
      inList(t.status, ['draft', 'submitted', 'reviewing', 'in_progress', 'responded', 'done', 'rejected']),
    ),
  ],
)

export const thread = pgTable(
  'thread',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').unique('thread_task_id_key').references((): AnyPgColumn => task.id, { onDelete: 'cascade' }),
    srId: text('sr_id').unique('thread_sr_id_key').references((): AnyPgColumn => serviceRequest.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    modelId: text('model_id'),
    createdBy: text('created_by').notNull().references((): AnyPgColumn => appUser.id),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [check('thread_check', sql`(${t.taskId} is null) <> (${t.srId} is null)`)],
)

export const message = pgTable(
  'message',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id').notNull().references((): AnyPgColumn => thread.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    role: text('role').notNull(),
    kind: text('kind'),
    content: text('content').notNull(),
    authorId: text('author_id').references((): AnyPgColumn => appUser.id),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('message_role_check', inList(t.role, ['system', 'user', 'assistant'])),
    check('message_kind_check', inList(t.kind, ['discussion'])),
    check('message_status_check', inList(t.status, ['streaming', 'done', 'error'])),
    unique('message_thread_id_seq_key').on(t.threadId, t.seq),
  ],
)

export const messageAttachment = pgTable(
  'message_attachment',
  {
    messageId: text('message_id').notNull().references((): AnyPgColumn => message.id, { onDelete: 'cascade' }),
    fileId: text('file_id').notNull().references((): AnyPgColumn => fileObject.id),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.fileId] })],
)

// ── 입력 선택 (파일·참조 대화) ─────────────────────────────────────────────
export const taskInput = pgTable(
  'task_input',
  {
    taskId: text('task_id').notNull().references((): AnyPgColumn => task.id, { onDelete: 'cascade' }),
    fileId: text('file_id').notNull().references((): AnyPgColumn => fileObject.id),
    weight: text('weight').notNull(),
    sortOrder: integer('sort_order').notNull(),
    selectedBy: text('selected_by').notNull().references((): AnyPgColumn => appUser.id),
    selectedAt: tz('selected_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.fileId] }),
    check('task_input_weight_check', inList(t.weight, ['main', 'reference'])),
    index('task_input_by_file').on(t.fileId),
  ],
)

export const contextSnapshot = pgTable(
  'context_snapshot',
  {
    id: text('id').primaryKey(),
    sourceTaskId: text('source_task_id').notNull().references((): AnyPgColumn => task.id),
    mode: text('mode').notNull(),
    upToMessageId: text('up_to_message_id').references((): AnyPgColumn => message.id),
    summaryText: text('summary_text'),
    summarySource: text('summary_source'),
    summaryModel: text('summary_model'),
    createdBy: text('created_by').notNull().references((): AnyPgColumn => appUser.id),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('context_snapshot_mode_check', inList(t.mode, ['full', 'messages', 'summary'])),
    check('context_snapshot_summary_source_check', inList(t.summarySource, ['ai', 'rule'])),
    check('context_snapshot_check', sql`(${t.mode} = 'summary') = (${t.summaryText} is not null)`),
  ],
)

export const contextSnapshotMessage = pgTable(
  'context_snapshot_message',
  {
    snapshotId: text('snapshot_id').notNull().references((): AnyPgColumn => contextSnapshot.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull().references((): AnyPgColumn => message.id),
    seq: integer('seq').notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.messageId] })],
)

export const conversationInput = pgTable(
  'conversation_input',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull().references((): AnyPgColumn => task.id, { onDelete: 'cascade' }),
    sourceTaskId: text('source_task_id').notNull().references((): AnyPgColumn => task.id),
    weight: text('weight').notNull(),
    mode: text('mode').notNull(),
    snapshotId: text('snapshot_id').notNull().references((): AnyPgColumn => contextSnapshot.id),
    selectedBy: text('selected_by').notNull().references((): AnyPgColumn => appUser.id),
    selectedAt: tz('selected_at').notNull().defaultNow(),
  },
  (t) => [
    check('conversation_input_weight_check', inList(t.weight, ['main', 'reference'])),
    check('conversation_input_mode_check', inList(t.mode, ['full', 'messages', 'summary'])),
    unique('conversation_input_task_id_source_task_id_key').on(t.taskId, t.sourceTaskId),
    check('conversation_input_check', sql`${t.taskId} <> ${t.sourceTaskId}`),
    index('conversation_input_by_source').on(t.sourceTaskId),
  ],
)

// ── 요청 기록 ─────────────────────────────────────────────────────────────
export const chatRequest = pgTable(
  'chat_request',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id').notNull().references((): AnyPgColumn => thread.id),
    userMessageId: text('user_message_id').notNull().references((): AnyPgColumn => message.id),
    replyMessageId: text('reply_message_id')
      .notNull()
      .unique('chat_request_reply_message_id_key')
      .references((): AnyPgColumn => message.id),
    requestedBy: text('requested_by').notNull().references((): AnyPgColumn => appUser.id),
    retryOf: text('retry_of').references((): AnyPgColumn => chatRequest.id),
    status: text('status').notNull(),
    provider: text('provider').notNull(),
    transport: text('transport').notNull(),
    model: text('model').notNull(),
    bytes: integer('bytes').notNull(),
    limitBytes: integer('limit_bytes').notNull(),
    error: text('error'),
    snapshot: jsonb('snapshot'),
    leaseUntil: tz('lease_until'),
    createdAt: tz('created_at').notNull().defaultNow(),
    finishedAt: tz('finished_at'),
  },
  (t) => [
    check(
      'chat_request_status_check',
      inList(t.status, ['pending', 'streaming', 'succeeded', 'failed', 'cancelled', 'interrupted']),
    ),
    check('chat_request_provider_check', inList(t.provider, ['mock', 'live'])),
    check('chat_request_transport_check', inList(t.transport, ['inline', 'openwebui'])),
    uniqueIndex('chat_request_one_active').on(t.threadId).where(sql`${t.status} in ('pending', 'streaming')`),
  ],
)

export const chatRequestInput = pgTable(
  'chat_request_input',
  {
    requestId: text('request_id').notNull().references((): AnyPgColumn => chatRequest.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    weight: text('weight').notNull(),
    fileId: text('file_id').references((): AnyPgColumn => fileObject.id),
    fileVersion: integer('file_version'),
    sourceLabel: text('source_label'),
    oneShot: boolean('one_shot').notNull().default(false),
    delivery: text('delivery'),
    remoteId: text('remote_id'),
    sourceTaskId: text('source_task_id').references((): AnyPgColumn => task.id),
    snapshotId: text('snapshot_id').references((): AnyPgColumn => contextSnapshot.id),
    mode: text('mode'),
    messageCount: integer('message_count'),
    bytes: integer('bytes').notNull().default(0),
    error: text('error'),
  },
  (t) => [
    primaryKey({ columns: [t.requestId, t.seq] }),
    check('chat_request_input_kind_check', inList(t.kind, ['file', 'conversation'])),
    check('chat_request_input_weight_check', inList(t.weight, ['main', 'reference'])),
    check('chat_request_input_delivery_check', inList(t.delivery, ['attached', 'inline', 'metadata_only', 'failed'])),
    check('chat_request_input_mode_check', inList(t.mode, ['full', 'messages', 'summary'])),
    check('chat_request_input_check', sql`(${t.kind} = 'file') = (${t.fileId} is not null)`),
    check('chat_request_input_check1', sql`(${t.kind} = 'conversation') = (${t.snapshotId} is not null)`),
  ],
)

export const fileRemoteRef = pgTable(
  'file_remote_ref',
  {
    fileId: text('file_id').notNull().references((): AnyPgColumn => fileObject.id, { onDelete: 'cascade' }),
    scopeHash: text('scope_hash').notNull(),
    remoteId: text('remote_id').notNull(),
    uploadedAt: tz('uploaded_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.scopeHash] })],
)

// ── 체크리스트·노트·SR 결과·활동·알림·설정 ─────────────────────────────────
export const checklistItem = pgTable('checklist_item', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references((): AnyPgColumn => task.id, { onDelete: 'cascade' }),
  templateItemId: text('template_item_id').references((): AnyPgColumn => assistantChecklistTemplate.id),
  sortOrder: integer('sort_order').notNull(),
  label: text('label').notNull(),
  required: boolean('required').notNull().default(false),
  checked: boolean('checked').notNull().default(false),
  checkedBy: text('checked_by').references((): AnyPgColumn => appUser.id),
  checkedAt: tz('checked_at'),
})

export const checklistReview = pgTable(
  'checklist_review',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull().references((): AnyPgColumn => task.id, { onDelete: 'cascade' }),
    byUser: text('by_user').notNull().references((): AnyPgColumn => appUser.id),
    at: tz('at').notNull().defaultNow(),
    met: integer('met').notNull(),
    total: integer('total').notNull(),
    source: text('source').notNull(),
  },
  (t) => [check('checklist_review_source_check', inList(t.source, ['ai', 'rule']))],
)

export const checklistReviewItem = pgTable(
  'checklist_review_item',
  {
    reviewId: text('review_id').notNull().references((): AnyPgColumn => checklistReview.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull().references((): AnyPgColumn => checklistItem.id, { onDelete: 'cascade' }),
    met: boolean('met').notNull(),
    note: text('note').notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.itemId] })],
)

export const taskFeedback = pgTable(
  'task_feedback',
  {
    taskId: text('task_id').primaryKey().references((): AnyPgColumn => task.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    comment: text('comment').notNull().default(''),
    byUser: text('by_user').notNull().references((): AnyPgColumn => appUser.id),
    at: tz('at').notNull().defaultNow(),
  },
  (t) => [check('task_feedback_rating_check', sql`${t.rating} between 1 and 5`)],
)

export const note = pgTable('note', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references((): AnyPgColumn => task.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references((): AnyPgColumn => appUser.id),
  content: text('content').notNull(),
  createdAt: tz('created_at').notNull().defaultNow(),
})

export const noteAttachment = pgTable(
  'note_attachment',
  {
    noteId: text('note_id').notNull().references((): AnyPgColumn => note.id, { onDelete: 'cascade' }),
    fileId: text('file_id').notNull().references((): AnyPgColumn => fileObject.id),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.fileId] })],
)

export const sharedResult = pgTable('shared_result', {
  id: text('id').primaryKey(),
  srId: text('sr_id').notNull().references((): AnyPgColumn => serviceRequest.id, { onDelete: 'cascade' }),
  taskId: text('task_id').references((): AnyPgColumn => task.id),
  text: text('text').notNull().default(''),
  byUser: text('by_user').notNull().references((): AnyPgColumn => appUser.id),
  at: tz('at').notNull().defaultNow(),
})

export const sharedResultFile = pgTable(
  'shared_result_file',
  {
    resultId: text('result_id').notNull().references((): AnyPgColumn => sharedResult.id, { onDelete: 'cascade' }),
    fileId: text('file_id').notNull().references((): AnyPgColumn => fileObject.id),
  },
  (t) => [primaryKey({ columns: [t.resultId, t.fileId] })],
)

export const activityLog = pgTable(
  'activity_log',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    userId: text('user_id').notNull().references((): AnyPgColumn => appUser.id),
    taskId: text('task_id').references((): AnyPgColumn => task.id, { onDelete: 'set null' }),
    assistantId: text('assistant_id').references((): AnyPgColumn => assistant.id, { onDelete: 'set null' }),
    srId: text('sr_id').references((): AnyPgColumn => serviceRequest.id, { onDelete: 'set null' }),
    payload: jsonb('payload').notNull().default(sql`'{}'`),
    at: tz('at').notNull().defaultNow(),
  },
  (t) => [index('activity_by_task').on(t.taskId, t.at)],
)

export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references((): AnyPgColumn => appUser.id),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link: text('link').notNull(),
    at: tz('at').notNull().defaultNow(),
    readAt: tz('read_at'),
  },
  (t) => [index('notification_unread').on(t.userId).where(sql`${t.readAt} is null`)],
)

export const appSetting = pgTable('app_setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
})

// ── 인증 세션 (S0 추가 — 서버 세션, architecture §5) ───────────────────────
export const appSession = pgTable(
  'app_session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references((): AnyPgColumn => appUser.id, { onDelete: 'cascade' }),
    createdAt: tz('created_at').notNull().defaultNow(),
    expiresAt: tz('expires_at').notNull(),
  },
  (t) => [index('app_session_user').on(t.userId)],
)
