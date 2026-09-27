-- MES Agent Hub — PostgreSQL DDL 초안 (새 저장소용, 실행 검증 안 함)
-- 기준: docs/architecture/data-contract.md. 데모 IndexedDB v4의 엔티티를 관계형으로 펼친 것.
-- 원칙: 파일 바이트는 DB에 두지 않는다(storage_key만). 비밀값(API 키)은 DB에 두지 않는다.
-- ID: 데모 가져오기를 위해 문자열 PK를 그대로 받는다. 새 행은 서버가 UUID 문자열로 발급.

-- ── 사람·에이전트 ─────────────────────────────────────────────────────────
create table app_user (
  id              text primary key,
  sso_subject     text unique,                    -- 사내 SSO 주체 (운영)
  name            text not null,
  role            text not null default '',
  initials        text not null,
  color           text not null,
  is_system_owner boolean not null default false,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table file_object (
  id             text primary key,
  kind           text not null check (kind in ('task_file', 'sr_attachment', 'assistant_image')),
  origin_task_id text,                            -- FK는 task 생성 뒤 추가
  origin_sr_id   text,
  original_name  text not null,                   -- 원래 이름은 DB에만 (디스크 경로에 쓰지 않음)
  mime           text not null,
  size_bytes     bigint not null,
  sha256         char(64) not null,
  storage_key    text not null unique,            -- {yyyy}/{MM}/{id} — 서버 FileStorageService가 관리
  source         text not null check (source in ('upload', 'assistant')),
  is_output      boolean not null default false,  -- 이 대화의 산출물 표시
  version        integer not null check (version >= 1),
  previous_id    text references file_object(id),
  uploaded_by    text not null references app_user(id),
  uploaded_at    timestamptz not null default now(),
  deleted_at     timestamptz,                     -- 소프트 삭제 (참조가 없을 때 배치로 바이트 정리)
  check (not is_output or kind = 'task_file'),
  check ((kind = 'sr_attachment') = (origin_sr_id is not null))
);
create index file_object_origin_task on file_object(origin_task_id);
create index file_object_origin_sr on file_object(origin_sr_id);
-- 같은 대화·같은 이름의 버전은 유일
create unique index file_object_version on file_object(coalesce(origin_task_id, origin_sr_id), original_name, version) where deleted_at is null;

create table assistant (
  id           text primary key,                  -- 데모 slug를 그대로 쓰되 변경 불가 키로 취급
  name         text not null,
  level1       text not null,
  level2       text not null,
  summary      text not null default '',
  sort_order   integer not null,
  model_id     text,                              -- 비면 공통 기본 모델
  link1        text,
  doc_url      text,
  owner_id     text not null references app_user(id),
  status       text not null check (status in ('open', 'developing', 'testing', 'retired')),
  usage_example text not null default '',
  image_file_id text references file_object(id),
  color        text not null,
  revision     integer not null default 0,        -- 공통 순서 편집 충돌 검사
  created_by   text not null references app_user(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table assistant_expected_io (
  assistant_id text not null references assistant(id) on delete cascade,
  direction    text not null check (direction in ('input', 'output')),
  sort_order   integer not null,
  label        text not null,
  primary key (assistant_id, direction, sort_order)
);

create table assistant_checklist_template (
  id           text primary key,
  assistant_id text not null references assistant(id) on delete cascade,
  sort_order   integer not null,
  label        text not null,
  required     boolean not null default false
);

-- ── 대화(=업무)·스레드·메시지 ─────────────────────────────────────────────
create table task (
  id               text primary key,
  code             text not null unique,          -- WK-YYYY-NNNN (서버 시퀀스로 발급)
  assistant_id     text not null references assistant(id),
  title            text not null,
  title_source     text not null check (title_source in ('default', 'ai', 'manual')),
  summary          text not null default '',
  status           text not null check (status in ('todo', 'in_progress', 'on_hold', 'done')),
  owner_id         text not null references app_user(id),
  priority         text not null check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date         date,
  model_id         text,
  created_by       text not null references app_user(id),
  created_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  completed_by     text references app_user(id)
);
create index task_assistant on task(assistant_id);
create index task_last_activity on task(last_activity_at desc);
alter table file_object add foreign key (origin_task_id) references task(id);

create table task_assignee (
  task_id text not null references task(id) on delete cascade,
  user_id text not null references app_user(id),
  primary key (task_id, user_id)
);

create table tag (
  key        text primary key,                    -- 정규화 키 (NFKC·소문자·공백→하이픈)
  kind       text not null check (kind in ('sr', 'keyword')),
  label      text not null,                       -- 처음 쓴 표기
  created_at timestamptz not null default now()
);

create table task_tag (
  task_id  text not null references task(id) on delete cascade,
  tag_key  text not null references tag(key),
  added_by text not null references app_user(id),
  added_at timestamptz not null default now(),
  primary key (task_id, tag_key)
);
create index task_tag_by_tag on task_tag(tag_key);  -- 같은 태그 대화 찾기 (후보·공유 자료함)

create table service_request (
  id           text primary key,
  code         text unique,                       -- SR-YYYY-NNNN, 접수 전(draft)은 NULL
  requester_id text not null references app_user(id),
  title        text not null default '',
  title_source text not null check (title_source in ('default', 'ai', 'manual')),
  body         text not null default '',
  status       text not null check (status in ('draft', 'submitted', 'reviewing', 'in_progress', 'responded', 'done', 'rejected')),
  submitted_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table file_object add foreign key (origin_sr_id) references service_request(id);

create table thread (
  id         text primary key,
  task_id    text unique references task(id) on delete cascade,        -- 대화 1개 = 스레드 1개
  sr_id      text unique references service_request(id) on delete cascade,
  title      text not null,
  model_id   text,
  created_by text not null references app_user(id),
  created_at timestamptz not null default now(),
  check ((task_id is null) <> (sr_id is null))
);

create table message (
  id           text primary key,
  thread_id    text not null references thread(id) on delete cascade,
  seq          bigint not null,                   -- 스레드 안 순서 (데모는 증가하는 createdAt)
  role         text not null check (role in ('system', 'user', 'assistant')),
  kind         text check (kind in ('discussion')), -- 팀 의견: AI 요청에 넣지 않음
  content      text not null,
  author_id    text references app_user(id),
  status       text not null check (status in ('streaming', 'done', 'error')),
  error        text,
  created_at   timestamptz not null default now(),
  unique (thread_id, seq)
);

create table message_attachment (
  message_id text not null references message(id) on delete cascade,
  file_id    text not null references file_object(id),
  primary key (message_id, file_id)
);

-- ── 입력 선택 (파일·참조 대화) ─────────────────────────────────────────────
create table task_input (
  task_id     text not null references task(id) on delete cascade,
  file_id     text not null references file_object(id),   -- 특정 버전 고정 (새 버전으로 자동 교체 없음)
  weight      text not null check (weight in ('main', 'reference')),
  sort_order  integer not null,
  selected_by text not null references app_user(id),
  selected_at timestamptz not null default now(),
  primary key (task_id, file_id)
);
create index task_input_by_file on task_input(file_id);  -- 삭제 보호: 다른 대화가 쓰는지

create table context_snapshot (
  id              text primary key,
  source_task_id  text not null references task(id),     -- 참조 중이면 삭제 거부 (애플리케이션 규칙)
  mode            text not null check (mode in ('full', 'messages', 'summary')),
  up_to_message_id text references message(id),          -- 선택 시점 경계 ("새 메시지 N" 계산)
  summary_text    text,                                  -- summary 모드: 사람이 확인·수정한 본문
  summary_source  text check (summary_source in ('ai', 'rule')),
  summary_model   text,
  created_by      text not null references app_user(id),
  created_at      timestamptz not null default now(),
  check ((mode = 'summary') = (summary_text is not null))
);

create table context_snapshot_message (           -- full·messages 모드: 원문은 복사하지 않고 ID만
  snapshot_id text not null references context_snapshot(id) on delete cascade,
  message_id  text not null references message(id),
  seq         integer not null,
  primary key (snapshot_id, message_id)
);

create table conversation_input (
  id             text primary key,
  task_id        text not null references task(id) on delete cascade,
  source_task_id text not null references task(id),
  weight         text not null check (weight in ('main', 'reference')),
  mode           text not null check (mode in ('full', 'messages', 'summary')),
  snapshot_id    text not null references context_snapshot(id),
  selected_by    text not null references app_user(id),
  selected_at    timestamptz not null default now(),
  unique (task_id, source_task_id),
  check (task_id <> source_task_id)
);
create index conversation_input_by_source on conversation_input(source_task_id);

-- ── 요청 기록 ─────────────────────────────────────────────────────────────
create table chat_request (
  id               text primary key,
  thread_id        text not null references thread(id),
  user_message_id  text not null references message(id),
  reply_message_id text not null unique references message(id),
  requested_by     text not null references app_user(id),
  retry_of         text references chat_request(id),
  status           text not null check (status in ('pending', 'streaming', 'succeeded', 'failed', 'cancelled', 'interrupted')),
  provider         text not null check (provider in ('mock', 'live')),
  transport        text not null check (transport in ('inline', 'openwebui')),
  model            text not null,
  bytes            integer not null,
  limit_bytes      integer not null,
  error            text,
  snapshot         jsonb,                          -- 원본 요청 본문 (키 제외)
  lease_until      timestamptz,                    -- 서버 작업 생존 신호
  created_at       timestamptz not null default now(),
  finished_at      timestamptz
);
-- 대화당 진행 중 요청 1건
create unique index chat_request_one_active on chat_request(thread_id) where status in ('pending', 'streaming');

create table chat_request_input (
  request_id     text not null references chat_request(id) on delete cascade,
  seq            integer not null,
  kind           text not null check (kind in ('file', 'conversation')),
  weight         text not null check (weight in ('main', 'reference')),
  file_id        text references file_object(id),
  file_version   integer,
  source_label   text,
  one_shot       boolean not null default false,
  delivery       text check (delivery in ('attached', 'inline', 'metadata_only', 'failed')),
  remote_id      text,                             -- 감사용 (재사용 캐시는 file_remote_ref)
  source_task_id text references task(id),
  snapshot_id    text references context_snapshot(id),
  mode           text check (mode in ('full', 'messages', 'summary')),
  message_count  integer,
  bytes          integer not null default 0,
  error          text,
  primary key (request_id, seq),
  check ((kind = 'file') = (file_id is not null)),
  check ((kind = 'conversation') = (snapshot_id is not null))
);

create table file_remote_ref (                     -- OpenWebUI 파일 재사용 캐시 (서버·키 범위별)
  file_id     text not null references file_object(id) on delete cascade,
  scope_hash  text not null,
  remote_id   text not null,
  uploaded_at timestamptz not null default now(),
  primary key (file_id, scope_hash)
);

-- ── 체크리스트·노트·SR 결과·활동·알림·설정 ─────────────────────────────────
create table checklist_item (
  id         text primary key,
  task_id    text not null references task(id) on delete cascade,
  template_item_id text references assistant_checklist_template(id),
  sort_order integer not null,
  label      text not null,
  required   boolean not null default false,
  checked    boolean not null default false,
  checked_by text references app_user(id),
  checked_at timestamptz
);

create table checklist_review (
  id      text primary key,
  task_id text not null references task(id) on delete cascade,
  by_user text not null references app_user(id),
  at      timestamptz not null default now(),
  met     integer not null,
  total   integer not null,
  source  text not null check (source in ('ai', 'rule'))
);

create table checklist_review_item (
  review_id text not null references checklist_review(id) on delete cascade,
  item_id   text not null references checklist_item(id) on delete cascade,
  met       boolean not null,
  note      text not null default '',
  primary key (review_id, item_id)
);

create table task_feedback (
  task_id text primary key references task(id) on delete cascade,
  rating  integer not null check (rating between 1 and 5),
  comment text not null default '',
  by_user text not null references app_user(id),
  at      timestamptz not null default now()
);

create table note (
  id         text primary key,
  task_id    text not null references task(id) on delete cascade,
  author_id  text not null references app_user(id),
  content    text not null,
  created_at timestamptz not null default now()
);

create table note_attachment (
  note_id text not null references note(id) on delete cascade,
  file_id text not null references file_object(id),
  primary key (note_id, file_id)
);

create table shared_result (                        -- 요청자에게 명시적으로 공유한 결과 (내부 대화는 공유 안 함)
  id      text primary key,
  sr_id   text not null references service_request(id) on delete cascade,
  task_id text references task(id),
  text    text not null default '',
  by_user text not null references app_user(id),
  at      timestamptz not null default now()
);

create table shared_result_file (
  result_id text not null references shared_result(id) on delete cascade,
  file_id   text not null references file_object(id),
  primary key (result_id, file_id)
);

create table activity_log (
  id           text primary key,
  type         text not null,
  user_id      text not null references app_user(id),
  task_id      text references task(id) on delete set null,
  assistant_id text references assistant(id) on delete set null,
  sr_id        text references service_request(id) on delete set null,
  payload      jsonb not null default '{}',
  at           timestamptz not null default now()
);
create index activity_by_task on activity_log(task_id, at);

create table notification (
  id      text primary key,
  user_id text not null references app_user(id),
  title   text not null,
  body    text not null default '',
  link    text not null,
  at      timestamptz not null default now(),
  read_at timestamptz
);
create index notification_unread on notification(user_id) where read_at is null;

create table app_setting (                          -- 전역 설정만. API 키는 서버 비밀 저장소
  key   text primary key,                           -- 예: default_model, file_delivery, request_budget_bytes, sr_intake_assistant_id
  value jsonb not null
);
