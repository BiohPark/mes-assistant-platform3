// MariaDB DDL 정본. 마이그레이션과 schema-drift 테스트로 일치 여부를 확인한다.
import type { Theme, Locale } from '@mes/contracts'
import { sql, type AnyColumn } from 'drizzle-orm'
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date as mysqlDate,
  foreignKey,
  index,
  int as integer,
  longtext,
  mysqlTable,
  varchar,
  primaryKey,
  text,
  datetime,
  unique,
  uniqueIndex,
} from 'drizzle-orm/mysql-core'

const tz = (name: string) => datetime(name, { fsp: 6 })
const date = (name: string) => mysqlDate(name, { mode: 'string' })
const inList = (col: AnyColumn, values: string[]) =>
  sql`${col} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`
const jsonObject = customType<{ data: unknown; driverData: string | object }>({
  dataType: () => 'json',
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => typeof value === 'string' ? JSON.parse(value) : value,
})

/** 없는 행의 경쟁도 트랜잭션 동안 직렬화할 수 있는 이름 잠금 행. */
export const dbLock = mysqlTable('db_lock', {
  lockKey: varchar('lock_key', { length: 191 }).primaryKey(),
})

// ── 사람·에이전트 ─────────────────────────────────────────────────────────
export const appUser = mysqlTable('app_user', {
  id: varchar('id', { length: 191 }).primaryKey(),
  ssoSubject: varchar('sso_subject', { length: 512 }).unique('app_user_sso_subject_key'),
  name: text('name').notNull(),
  role: text('role').notNull().default(''),
  initials: text('initials').notNull(),
  color: text('color').notNull(),
  isSystemOwner: boolean('is_system_owner').notNull().default(false),
  isBusinessOwner: boolean('is_business_owner').notNull().default(false),
  active: boolean('active').notNull().default(true),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  createdAt: tz('created_at').notNull().default(sql`current_timestamp(6)`),
  loginId: varchar('login_id', { length: 191 }).unique('app_user_login_id_key'),
  passwordHash: text('password_hash'),
  theme: varchar('theme', { length: 8 }).$type<Theme>().notNull().default('system'),
  locale: varchar('locale', { length: 8 }).$type<Locale>().notNull().default('ko'),
}, (t) => [
  check('app_user_theme_check', inList(t.theme, ['system', 'light', 'dark'])),
  check('app_user_locale_check', inList(t.locale, ['ko', 'en'])),
])

export const codeGroup = mysqlTable('code_group', {
  key: varchar('key', { length: 191 }).primaryKey(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const code = mysqlTable('code', {
  id: varchar('id', { length: 191 }).primaryKey(),
  groupKey: varchar('group_key', { length: 191 }).notNull().references(() => codeGroup.key),
  code: varchar('code', { length: 191 }).notNull(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
}, (t) => [unique('code_group_key_code_key').on(t.groupKey, t.code)])

export const fileObject = mysqlTable(
  'file_object',
  {
    id: varchar('id', { length: 191 }).primaryKey(),
    kind: text('kind').notNull(),
    originTaskId: varchar('origin_task_id', { length: 191 }).references((): AnyMySqlColumn => task.id),
    originSrId: varchar('origin_sr_id', { length: 191 }).references((): AnyMySqlColumn => serviceRequest.id),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    storageKey: varchar('storage_key', { length: 191 }).notNull().unique('file_object_storage_key_key'),
    source: text('source').notNull(),
    isOutput: boolean('is_output').notNull().default(false),
    version: integer('version').notNull(),
    previousId: varchar('previous_id', { length: 191 }).references((): AnyMySqlColumn => fileObject.id),
    uploadedBy: varchar('uploaded_by', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    uploadedAt: tz('uploaded_at').notNull().default(sql`current_timestamp(6)`),
    deletedAt: tz('deleted_at'),
    activeOrigin: varchar('active_origin', { length: 191 }).generatedAlwaysAs(() => sql`case when deleted_at is null then coalesce(origin_task_id, origin_sr_id) else null end`, { mode: 'stored' }),
  },
  (t) => [
    check('file_object_kind_check', inList(t.kind, ['task_file', 'sr_attachment', 'assistant_image'])),
    check('file_object_source_check', inList(t.source, ['upload', 'assistant'])),
    check('file_object_version_check', sql`${t.version} >= 1`),
    check('file_object_check', sql`not ${t.isOutput} or ${t.kind} = 'task_file'`),
    check('file_object_check1', sql`(${t.kind} = 'sr_attachment') = (${t.originSrId} is not null)`),
    index('file_object_origin_task').on(t.originTaskId),
    index('file_object_origin_sr').on(t.originSrId),
    uniqueIndex('file_object_version').on(t.activeOrigin, t.originalName, t.version),
  ],
)

export const assistant = mysqlTable(
  'assistant',
  {
    id: varchar('id', { length: 191 }).primaryKey(),
    name: text('name').notNull(),
    level1CodeId: varchar('level1_code_id', { length: 191 }).notNull().references(() => code.id),
    level2CodeId: varchar('level2_code_id', { length: 191 }).notNull().references(() => code.id),
    summary: longtext('summary').notNull().default(''),
    sortOrder: integer('sort_order').notNull(),
    modelId: text('model_id'),
    link1: text('link1'),
    docUrl: text('doc_url'),
    ownerId: varchar('owner_id', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    status: text('status').notNull(),
    usageExample: longtext('usage_example').notNull().default(''),
    imageFileId: varchar('image_file_id', { length: 191 }).references((): AnyMySqlColumn => fileObject.id),
    color: text('color').notNull(),
    revision: integer('revision').notNull().default(0),
    createdBy: varchar('created_by', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    createdAt: tz('created_at').notNull().default(sql`current_timestamp(6)`),
    updatedAt: tz('updated_at').notNull().default(sql`current_timestamp(6)`),
  },
  (t) => [check('assistant_status_check', inList(t.status, ['open', 'developing', 'testing', 'retired']))],
)

export const assistantExpectedIo = mysqlTable(
  'assistant_expected_io',
  {
    assistantId: varchar('assistant_id', { length: 191 }).notNull().references((): AnyMySqlColumn => assistant.id, { onDelete: 'cascade' }),
    direction: varchar('direction', { length: 191 }).notNull(),
    sortOrder: integer('sort_order').notNull(),
    label: text('label').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.assistantId, t.direction, t.sortOrder] }),
    check('assistant_expected_io_direction_check', inList(t.direction, ['input', 'output'])),
  ],
)

export const assistantChecklistTemplate = mysqlTable('assistant_checklist_template', {
  id: varchar('id', { length: 191 }).primaryKey(),
  assistantId: varchar('assistant_id', { length: 191 }).notNull().references((): AnyMySqlColumn => assistant.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
  label: text('label').notNull(),
  required: boolean('required').notNull().default(false),
})

// ── 대화(=업무)·스레드·메시지 ─────────────────────────────────────────────
export const task = mysqlTable(
  'task',
  {
    id: varchar('id', { length: 191 }).primaryKey(),
    code: varchar('code', { length: 191 }).notNull().unique('task_code_key'),
    assistantId: varchar('assistant_id', { length: 191 }).notNull().references((): AnyMySqlColumn => assistant.id),
    srId: varchar('sr_id', { length: 191 }).references((): AnyMySqlColumn => serviceRequest.id),
    title: text('title').notNull(),
    titleSource: text('title_source').notNull(),
    summary: longtext('summary').notNull().default(''),
    status: text('status').notNull(),
    ownerId: varchar('owner_id', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    priority: text('priority').notNull(),
    dueDate: date('due_date'),
    modelId: text('model_id'),
    createdBy: varchar('created_by', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    createdAt: tz('created_at').notNull().default(sql`current_timestamp(6)`),
    lastActivityAt: tz('last_activity_at').notNull().default(sql`current_timestamp(6)`),
    startedAt: tz('started_at'),
    completedAt: tz('completed_at'),
    completedBy: varchar('completed_by', { length: 191 }).references((): AnyMySqlColumn => appUser.id),
    idempotencyKey: varchar('idempotency_key', { length: 191 }),
    deletedAt: tz('deleted_at'),
  },
  (t) => [
    check('task_title_source_check', inList(t.titleSource, ['default', 'ai', 'manual'])),
    check('task_status_check', inList(t.status, ['todo', 'in_progress', 'on_hold', 'done'])),
    check('task_priority_check', inList(t.priority, ['low', 'normal', 'high', 'urgent'])),
    index('task_assistant').on(t.assistantId),
    index('task_last_activity').on(t.lastActivityAt),
    unique('task_idempotency_key_key').on(t.idempotencyKey),
  ],
)

export const taskAssignee = mysqlTable(
  'task_assignee',
  {
    taskId: varchar('task_id', { length: 191 }).notNull().references((): AnyMySqlColumn => task.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] })],
)

export const tag = mysqlTable(
  'tag',
  {
    key: varchar('key', { length: 191 }).primaryKey(),
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    createdAt: tz('created_at').notNull().default(sql`current_timestamp(6)`),
  },
  (t) => [check('tag_kind_check', inList(t.kind, ['sr', 'keyword']))],
)

export const taskTag = mysqlTable(
  'task_tag',
  {
    taskId: varchar('task_id', { length: 191 }).notNull().references((): AnyMySqlColumn => task.id, { onDelete: 'cascade' }),
    tagKey: varchar('tag_key', { length: 191 }).notNull().references((): AnyMySqlColumn => tag.key),
    addedBy: varchar('added_by', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    addedAt: tz('added_at').notNull().default(sql`current_timestamp(6)`),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagKey] }), index('task_tag_by_tag').on(t.tagKey)],
)

export const serviceRequest = mysqlTable(
  'service_request',
  {
    id: varchar('id', { length: 191 }).primaryKey(),
    code: varchar('code', { length: 191 }).unique('service_request_code_key'),
    requesterId: varchar('requester_id', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    title: text('title').notNull().default(''),
    titleSource: text('title_source').notNull(),
    body: longtext('body').notNull().default(''),
    status: text('status').notNull(),
    submittedAt: tz('submitted_at'),
    createdAt: tz('created_at').notNull().default(sql`current_timestamp(6)`),
    updatedAt: tz('updated_at').notNull().default(sql`current_timestamp(6)`),
  },
  (t) => [
    check('service_request_title_source_check', inList(t.titleSource, ['default', 'ai', 'manual'])),
    check(
      'service_request_status_check',
      inList(t.status, ['draft', 'submitted', 'reviewing', 'in_progress', 'responded', 'done', 'rejected']),
    ),
  ],
)

export const thread = mysqlTable(
  'thread',
  {
    id: varchar('id', { length: 191 }).primaryKey(),
    taskId: varchar('task_id', { length: 191 }).unique('thread_task_id_key').references((): AnyMySqlColumn => task.id, { onDelete: 'cascade' }),
    srId: varchar('sr_id', { length: 191 }).unique('thread_sr_id_key').references((): AnyMySqlColumn => serviceRequest.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    modelId: text('model_id'),
    createdBy: varchar('created_by', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    createdAt: tz('created_at').notNull().default(sql`current_timestamp(6)`),
  },
  (t) => [check('thread_check', sql`(${t.taskId} is null) <> (${t.srId} is null)`)],
)

export const message = mysqlTable(
  'message',
  {
    id: varchar('id', { length: 191 }).primaryKey(),
    threadId: varchar('thread_id', { length: 191 }).notNull().references((): AnyMySqlColumn => thread.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    role: text('role').notNull(),
    kind: text('kind'),
    content: longtext('content').notNull(),
    authorId: varchar('author_id', { length: 191 }).references((): AnyMySqlColumn => appUser.id),
    status: text('status').notNull(),
    error: longtext('error'),
    createdAt: tz('created_at').notNull().default(sql`current_timestamp(6)`),
  },
  (t) => [
    check('message_role_check', inList(t.role, ['system', 'user', 'assistant'])),
    check('message_kind_check', inList(t.kind, ['discussion'])),
    check('message_status_check', inList(t.status, ['streaming', 'done', 'error'])),
    unique('message_thread_id_seq_key').on(t.threadId, t.seq),
  ],
)

export const messageAttachment = mysqlTable(
  'message_attachment',
  {
    messageId: varchar('message_id', { length: 191 }).notNull().references((): AnyMySqlColumn => message.id, { onDelete: 'cascade' }),
    fileId: varchar('file_id', { length: 191 }).notNull().references((): AnyMySqlColumn => fileObject.id),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.fileId] })],
)

// ── 입력 선택 (파일·참조 대화) ─────────────────────────────────────────────
export const taskInput = mysqlTable(
  'task_input',
  {
    taskId: varchar('task_id', { length: 191 }).notNull().references((): AnyMySqlColumn => task.id, { onDelete: 'cascade' }),
    fileId: varchar('file_id', { length: 191 }).notNull().references((): AnyMySqlColumn => fileObject.id),
    weight: text('weight').notNull(),
    sortOrder: integer('sort_order').notNull(),
    selectedBy: varchar('selected_by', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    selectedAt: tz('selected_at').notNull().default(sql`current_timestamp(6)`),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.fileId] }),
    check('task_input_weight_check', inList(t.weight, ['main', 'reference'])),
    index('task_input_by_file').on(t.fileId),
  ],
)

export const contextSnapshot = mysqlTable(
  'context_snapshot',
  {
    id: varchar('id', { length: 191 }).primaryKey(),
    sourceTaskId: varchar('source_task_id', { length: 191 }).notNull().references((): AnyMySqlColumn => task.id),
    mode: text('mode').notNull(),
    upToMessageId: varchar('up_to_message_id', { length: 191 }).references((): AnyMySqlColumn => message.id),
    summaryText: longtext('summary_text'),
    summarySource: text('summary_source'),
    summaryModel: text('summary_model'),
    createdBy: varchar('created_by', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    createdAt: tz('created_at').notNull().default(sql`current_timestamp(6)`),
  },
  (t) => [
    check('context_snapshot_mode_check', inList(t.mode, ['full', 'messages', 'summary'])),
    check('context_snapshot_summary_source_check', inList(t.summarySource, ['ai', 'rule'])),
    check('context_snapshot_check', sql`(${t.mode} = 'summary') = (${t.summaryText} is not null)`),
  ],
)

export const contextSnapshotMessage = mysqlTable(
  'context_snapshot_message',
  {
    snapshotId: varchar('snapshot_id', { length: 191 }).notNull().references((): AnyMySqlColumn => contextSnapshot.id, { onDelete: 'cascade' }),
    messageId: varchar('message_id', { length: 191 }).notNull().references((): AnyMySqlColumn => message.id),
    seq: integer('seq').notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.messageId] })],
)

export const conversationInput = mysqlTable(
  'conversation_input',
  {
    id: varchar('id', { length: 191 }).primaryKey(),
    taskId: varchar('task_id', { length: 191 }).notNull().references((): AnyMySqlColumn => task.id, { onDelete: 'cascade' }),
    sourceTaskId: varchar('source_task_id', { length: 191 }).notNull().references((): AnyMySqlColumn => task.id),
    weight: text('weight').notNull(),
    mode: text('mode').notNull(),
    snapshotId: varchar('snapshot_id', { length: 191 }).notNull().references((): AnyMySqlColumn => contextSnapshot.id),
    selectedBy: varchar('selected_by', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    selectedAt: tz('selected_at').notNull().default(sql`current_timestamp(6)`),
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
export const chatRequest = mysqlTable(
  'chat_request',
  {
    id: varchar('id', { length: 191 }).primaryKey(),
    threadId: varchar('thread_id', { length: 191 }).notNull().references((): AnyMySqlColumn => thread.id),
    userMessageId: varchar('user_message_id', { length: 191 }).notNull().references((): AnyMySqlColumn => message.id),
    replyMessageId: varchar('reply_message_id', { length: 191 })
      .notNull()
      .unique('chat_request_reply_message_id_key')
      .references((): AnyMySqlColumn => message.id),
    requestedBy: varchar('requested_by', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    retryOf: varchar('retry_of', { length: 191 }).references((): AnyMySqlColumn => chatRequest.id),
    status: text('status').notNull(),
    activeThreadId: varchar('active_thread_id', { length: 191 }).generatedAlwaysAs(() => sql`case when status in ('pending', 'streaming') then thread_id else null end`, { mode: 'stored' }),
    idempotencyKey: varchar('idempotency_key', { length: 191 }),
    phase: text('phase'),
    provider: text('provider').notNull(),
    transport: text('transport').notNull(),
    model: text('model').notNull(),
    bytes: integer('bytes').notNull(),
    limitBytes: integer('limit_bytes').notNull(),
    error: longtext('error'),
    snapshot: jsonObject('snapshot'),
    leaseUntil: tz('lease_until'),
    createdAt: tz('created_at').notNull().default(sql`current_timestamp(6)`),
    finishedAt: tz('finished_at'),
  },
  (t) => [
    check(
      'chat_request_status_check',
      inList(t.status, ['pending', 'streaming', 'succeeded', 'failed', 'cancelled', 'interrupted']),
    ),
    check('chat_request_provider_check', inList(t.provider, ['mock', 'live'])),
    check('chat_request_transport_check', inList(t.transport, ['inline', 'openwebui'])),
    uniqueIndex('chat_request_one_active').on(t.activeThreadId),
    unique('chat_request_thread_id_idempotency_key_key').on(t.threadId, t.idempotencyKey),
  ],
)

export const chatRequestInput = mysqlTable(
  'chat_request_input',
  {
    requestId: varchar('request_id', { length: 191 }).notNull().references((): AnyMySqlColumn => chatRequest.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    weight: text('weight').notNull(),
    fileId: varchar('file_id', { length: 191 }).references((): AnyMySqlColumn => fileObject.id),
    fileVersion: integer('file_version'),
    sourceLabel: text('source_label'),
    oneShot: boolean('one_shot').notNull().default(false),
    delivery: text('delivery'),
    remoteId: text('remote_id'),
    sourceTaskId: varchar('source_task_id', { length: 191 }).references((): AnyMySqlColumn => task.id),
    snapshotId: varchar('snapshot_id', { length: 191 }).references((): AnyMySqlColumn => contextSnapshot.id),
    mode: text('mode'),
    messageCount: integer('message_count'),
    bytes: integer('bytes').notNull().default(0),
    error: longtext('error'),
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

export const fileRemoteRef = mysqlTable(
  'file_remote_ref',
  {
    fileId: varchar('file_id', { length: 191 }).notNull().references((): AnyMySqlColumn => fileObject.id, { onDelete: 'cascade' }),
    scopeHash: varchar('scope_hash', { length: 191 }).notNull(),
    remoteId: text('remote_id').notNull(),
    uploadedAt: tz('uploaded_at').notNull().default(sql`current_timestamp(6)`),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.scopeHash] })],
)

// ── 체크리스트·노트·SR 결과·활동·알림·설정 ─────────────────────────────────
export const checklistItem = mysqlTable('checklist_item', {
  id: varchar('id', { length: 191 }).primaryKey(),
  taskId: varchar('task_id', { length: 191 }).notNull().references((): AnyMySqlColumn => task.id, { onDelete: 'cascade' }),
  templateItemId: varchar('template_item_id', { length: 191 }),
  sortOrder: integer('sort_order').notNull(),
  label: text('label').notNull(),
  required: boolean('required').notNull().default(false),
  checked: boolean('checked').notNull().default(false),
  checkedBy: varchar('checked_by', { length: 191 }).references((): AnyMySqlColumn => appUser.id),
  checkedAt: tz('checked_at'),
}, (t) => [foreignKey({ name: 'checklist_item_template_item_id_fk', columns: [t.templateItemId], foreignColumns: [assistantChecklistTemplate.id] })])

export const checklistReview = mysqlTable(
  'checklist_review',
  {
    id: varchar('id', { length: 191 }).primaryKey(),
    taskId: varchar('task_id', { length: 191 }).notNull().references((): AnyMySqlColumn => task.id, { onDelete: 'cascade' }),
    byUser: varchar('by_user', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    at: tz('at').notNull().default(sql`current_timestamp(6)`),
    met: integer('met').notNull(),
    total: integer('total').notNull(),
    source: text('source').notNull(),
  },
  (t) => [check('checklist_review_source_check', inList(t.source, ['ai', 'rule']))],
)

export const checklistReviewItem = mysqlTable(
  'checklist_review_item',
  {
    reviewId: varchar('review_id', { length: 191 }).notNull().references((): AnyMySqlColumn => checklistReview.id, { onDelete: 'cascade' }),
    itemId: varchar('item_id', { length: 191 }).notNull().references((): AnyMySqlColumn => checklistItem.id, { onDelete: 'cascade' }),
    met: boolean('met').notNull(),
    note: text('note').notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.itemId] })],
)

export const taskFeedback = mysqlTable(
  'task_feedback',
  {
    taskId: varchar('task_id', { length: 191 }).primaryKey().references((): AnyMySqlColumn => task.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    comment: text('comment').notNull().default(''),
    byUser: varchar('by_user', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    at: tz('at').notNull().default(sql`current_timestamp(6)`),
  },
  (t) => [check('task_feedback_rating_check', sql`${t.rating} between 1 and 5`)],
)

export const note = mysqlTable('note', {
  id: varchar('id', { length: 191 }).primaryKey(),
  taskId: varchar('task_id', { length: 191 }).notNull().references((): AnyMySqlColumn => task.id, { onDelete: 'cascade' }),
  authorId: varchar('author_id', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
  content: longtext('content').notNull(),
  createdAt: tz('created_at').notNull().default(sql`current_timestamp(6)`),
})

export const noteAttachment = mysqlTable(
  'note_attachment',
  {
    noteId: varchar('note_id', { length: 191 }).notNull().references((): AnyMySqlColumn => note.id, { onDelete: 'cascade' }),
    fileId: varchar('file_id', { length: 191 }).notNull().references((): AnyMySqlColumn => fileObject.id),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.fileId] })],
)

export const sharedResult = mysqlTable('shared_result', {
  id: varchar('id', { length: 191 }).primaryKey(),
  srId: varchar('sr_id', { length: 191 }).notNull().references((): AnyMySqlColumn => serviceRequest.id, { onDelete: 'cascade' }),
  taskId: varchar('task_id', { length: 191 }).references((): AnyMySqlColumn => task.id),
  text: longtext('text').notNull().default(''),
  byUser: varchar('by_user', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
  at: tz('at').notNull().default(sql`current_timestamp(6)`),
})

export const sharedResultFile = mysqlTable(
  'shared_result_file',
  {
    resultId: varchar('result_id', { length: 191 }).notNull().references((): AnyMySqlColumn => sharedResult.id, { onDelete: 'cascade' }),
    fileId: varchar('file_id', { length: 191 }).notNull().references((): AnyMySqlColumn => fileObject.id),
  },
  (t) => [primaryKey({ columns: [t.resultId, t.fileId] })],
)

export const activityLog = mysqlTable(
  'activity_log',
  {
    id: varchar('id', { length: 191 }).primaryKey(),
    type: text('type').notNull(),
    userId: varchar('user_id', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    taskId: varchar('task_id', { length: 191 }).references((): AnyMySqlColumn => task.id, { onDelete: 'set null' }),
    assistantId: varchar('assistant_id', { length: 191 }).references((): AnyMySqlColumn => assistant.id, { onDelete: 'set null' }),
    srId: varchar('sr_id', { length: 191 }).references((): AnyMySqlColumn => serviceRequest.id, { onDelete: 'set null' }),
    payload: jsonObject('payload').notNull().default(sql`'{}'`),
    at: tz('at').notNull().default(sql`current_timestamp(6)`),
  },
  (t) => [index('activity_by_task').on(t.taskId, t.at), index('activity_at').on(t.at)],
)

export const notification = mysqlTable(
  'notification',
  {
    id: varchar('id', { length: 191 }).primaryKey(),
    userId: varchar('user_id', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id),
    title: text('title').notNull(),
    body: longtext('body').notNull().default(''),
    link: text('link').notNull(),
    at: tz('at').notNull().default(sql`current_timestamp(6)`),
    readAt: tz('read_at'),
  },
  (t) => [index('notification_unread').on(t.userId, t.readAt)],
)

export const appSetting = mysqlTable('app_setting', {
  key: varchar('key', { length: 191 }).primaryKey(),
  value: jsonObject('value').notNull(),
})

// ── 인증 세션 (S0 추가 — 서버 세션, architecture §5) ───────────────────────
export const appSession = mysqlTable(
  'app_session',
  {
    id: varchar('id', { length: 191 }).primaryKey(),
    userId: varchar('user_id', { length: 191 }).notNull().references((): AnyMySqlColumn => appUser.id, { onDelete: 'cascade' }),
    createdAt: tz('created_at').notNull().default(sql`current_timestamp(6)`),
    expiresAt: tz('expires_at').notNull(),
  },
  (t) => [index('app_session_user').on(t.userId)],
)
