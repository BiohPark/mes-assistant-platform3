// 도메인 타입 정의. 데이터는 불변으로 다루고, 변경은 항상 새 객체를 반환한다.

export type ID = string
export type ISODate = string

export interface User {
  id: ID
  name: string
  role: string
  initials: string
  color: string
  /** System Owner: 에이전트 순서·설정 편집, 타인 SR 제목 수정 */
  isSystemOwner?: boolean
}

export type AssistantStatus = 'open' | 'developing' | 'testing' | 'retired'
export const ASSISTANT_STATUSES: AssistantStatus[] = ['open', 'developing', 'testing', 'retired']

export interface ChecklistTemplateItem {
  id: ID
  label: string
  required: boolean
}

/** 어시스턴트 카탈로그 항목. id는 내부 slug, 실제 호출 모델은 modelId(없으면 공통 기본 모델). */
export interface Assistant {
  id: ID
  name: string
  level1: string
  level2: string
  summary: string
  /** 갤러리·칸반 공통 순서 (SO가 편집 모드에서 드래그로 정함) */
  order: number
  /** 사내 AI 모델 ID. 비어 있으면 설정의 공통 기본 모델 */
  modelId?: string
  /** 링크1: 외부 assistant 주소(명시). 없으면 modelId로 파생 */
  link1?: string
  /** 링크2: 자체 관리 설명 페이지 */
  docUrl?: string
  /** 워크플로우상 기대 입력/산출물 안내 (강제 아님) */
  expectedInputs: string[]
  expectedOutputs: string[]
  ownerId: ID
  status: AssistantStatus
  /** 사용법 (markdown) */
  usageExample: string
  /** @deprecated 역할·흐름은 각 assistant(OpenWebUI) 쪽에서 관리한다. 예전 데이터 호환용으로만 남기고 프롬프트에 넣지 않는다 */
  systemPromptHint?: string
  /** 카드 이미지 (FileAsset). 없으면 이니셜 */
  imageId?: ID
  color: string
  /** 새 대화에 복사되는 체크리스트 (강제 아님, 달성도 점검용) */
  checklistTemplate: ChecklistTemplateItem[]
  createdBy: ID
  createdAt: ISODate
  updatedAt: ISODate
}

export type TaskStatus = 'todo' | 'in_progress' | 'on_hold' | 'done'
export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'on_hold', 'done']
export type Priority = 'low' | 'normal' | 'high' | 'urgent'

export interface ChecklistItem {
  id: ID
  label: string
  required: boolean
  checked: boolean
  checkedBy?: ID
  checkedAt?: ISODate
}

export interface Feedback {
  rating: number
  comment: string
  by: ID
  at: ISODate
}

/** 입력 등급: ★ 주 입력 / ☑ 참고 */
export type InputWeight = 'main' | 'reference'

/** 대화에서 선택한 입력. 특정 파일 버전 ID를 고정하며 새 버전이 생겨도 자동 교체하지 않는다. */
export interface TaskInput {
  fileId: ID
  weight: InputWeight
  selectedAt: ISODate
  selectedBy: ID
}

/** 참조 대화 전달 범위: 전체 원문 / 고른 메시지 / 사람이 확인한 요약 */
export type ContextMode = 'full' | 'messages' | 'summary'

/**
 * 다른 대화를 AI 입력으로 고른 것 (파일 선택과 같은 규칙).
 * 같은 태그를 **직접** 공유하는 대화만 고를 수 있고, 선택 시점 스냅샷에 고정된다.
 * 참조 대화가 쓴 파일·다른 참조는 따라가지 않는다(재귀 수집 없음).
 */
export interface ConversationInput {
  id: ID
  /** 이 입력을 쓰는 대화 */
  taskId: ID
  /** 참조하는 대화 */
  sourceTaskId: ID
  weight: InputWeight
  mode: ContextMode
  snapshotId: ID
  selectedAt: ISODate
  selectedBy: ID
}

/**
 * 참조 대화의 선택 시점 고정본. 불변 — 갱신하면 새 스냅샷을 만든다.
 * 완료된 메시지는 바뀌지 않으므로 원문은 복사하지 않고 메시지 ID만 남긴다.
 */
export interface ContextSnapshot {
  id: ID
  sourceTaskId: ID
  mode: ContextMode
  /** full·messages: 전달할 메시지 ID (시간순) */
  messageIds: ID[]
  /** 선택 시점의 마지막 적격 메시지 — 이후 메시지는 "새 메시지"로 안내 */
  upToMessageId?: ID
  upToCreatedAt?: ISODate
  /** summary: 사람이 확인·수정해 적용한 요약 본문 */
  summaryText?: string
  summarySource?: 'ai' | 'rule'
  summaryModel?: string
  createdBy: ID
  createdAt: ISODate
}

export type TitleSource = 'default' | 'ai' | 'manual'

/** 업무 = 대화 1개. 항상 하나의 어시스턴트에 속하고, 다른 대화와는 태그로만 느슨하게 연결된다. */
export interface Task {
  id: ID
  code: string
  assistantId: ID
  title: string
  /** 제목 출처. manual이면 AI가 덮어쓰지 않는다 */
  titleSource: TitleSource
  summary: string
  status: TaskStatus
  ownerId: ID
  assigneeIds: ID[]
  priority: Priority
  dueDate?: ISODate
  /** 연결 태그 (SR 코드·CCA·자유 키워드). 같은 태그를 가진 대화끼리 자료를 발견할 수 있다 */
  tags: string[]
  checklist: ChecklistItem[]
  /** 사람이 선택한 입력 (주/참고). 태그만으로는 AI에 전달되지 않는다 */
  inputs: TaskInput[]
  /** 이 대화의 산출물 (생성 파일·저장한 답변 → 자동) */
  outputFileIds: ID[]
  /** 대화 1개 = 스레드 1개 */
  threadId?: ID
  /** 업무 단위 모델 오버라이드 */
  modelId?: string
  feedback?: Feedback
  /** 가장 최근 AI 달성도 점검 (강제 아님, 참고용 점수) */
  checklistReview?: ChecklistReview
  createdAt: ISODate
  createdBy: ID
  /** 칸반 정렬용 최근 활동 시각 */
  lastActivityAt: ISODate
  startedAt?: ISODate
  completedAt?: ISODate
  completedBy?: ID
}

/** 체크리스트 항목별 AI 판단 */
export interface ChecklistReviewItem {
  itemId: ID
  met: boolean
  note: string
}

/** AI 달성도 점검 결과: n개 중 m개 달성. 체크 상태를 바꾸지 않는 참고 점수다. */
export interface ChecklistReview {
  at: ISODate
  by: ID
  met: number
  total: number
  items: ChecklistReviewItem[]
  /** ai = 모델 판단, rule = Mock/실패 시 규칙 기반 */
  source: 'ai' | 'rule'
}

export interface Thread {
  id: ID
  taskId?: ID
  srId?: ID
  title: string
  createdAt: ISODate
  createdBy: ID
  archived: boolean
  /** 이 대화에서만 쓰는 모델 */
  modelId?: string
}

export type MessageRole = 'system' | 'user' | 'assistant'
export type MessageStatus = 'streaming' | 'done' | 'error'

/** 입력이 AI에 실제로 전달된 방식 */
export type InputDelivery = 'attached' | 'inline' | 'metadata_only' | 'failed'

export interface FileRequestInput {
  kind: 'file'
  fileId: ID
  name: string
  version: number
  weight: InputWeight
  /** 출처 표기 (예: "WK-2026-0001 · URS 분석 도우미", "이 대화", "SR 첨부") */
  source?: string
  /** 이번 메시지에만 붙인 첨부 (대화 입력으로 고정하지 않음) */
  oneShot?: boolean
  delivery: InputDelivery
  /** 텍스트 파일 여부 (실패 시 "텍스트로 보내기" 가능) */
  text: boolean
  /** OpenWebUI에 올린 파일 ID (감사용 기록. 재사용 캐시와 별개) */
  remoteId?: string
  bytes: number
  error?: string
}

export interface ConversationRequestInput {
  kind: 'conversation'
  sourceTaskId: ID
  code: string
  title: string
  assistantName: string
  weight: InputWeight
  mode: ContextMode
  snapshotId: ID
  messageCount: number
  bytes: number
}

export type RequestInput = FileRequestInput | ConversationRequestInput

/** 답변 1건을 만들 때 AI에 실제로 보낸 것 — 화면의 "사용한 자료"와 전송 기록 뷰어가 읽는다 */
export interface RequestInfo {
  at: ISODate
  provider: 'mock' | 'live'
  transport: 'inline' | 'openwebui'
  model: string
  /** 직렬화한 요청 본문 크기 (OpenWebUI 첨부 파일의 바이트는 제외) */
  bytes: number
  limitBytes: number
  inputs: RequestInput[]
  srCodes: string[]
  /** 다시 시도한 이전 답변 */
  retryOf?: ID
}

export interface Message {
  id: ID
  threadId: ID
  role: MessageRole
  content: string
  authorId?: ID
  createdAt: ISODate
  attachmentIds: ID[]
  status: MessageStatus
  error?: string
  /** 'discussion' = 팀 내부 의견. 스레드에 남지만 AI 요청에는 포함하지 않는다 */
  kind?: 'discussion'
  /** assistant 메시지: 실제로 전송한 요청 본문(JSON, API 키 제외). 감사·디버깅용 */
  requestSnapshot?: string
  /** assistant 메시지: 구조화된 전송 기록 (사용한 자료·전달 방식·크기) */
  requestInfo?: RequestInfo
  /** 응답 중인 자리표시의 생존 신호. 오래 갱신되지 않으면 끊긴 요청으로 정리한다 */
  heartbeatAt?: ISODate
  /** 응답을 요청한 사용자 (자리표시·답변에 기록) */
  requestedBy?: ID
}

export type FileSource = 'upload' | 'assistant' | 'sr'

/** 파일은 업무에 종속되지 않는다. origin*은 최초 생성 위치일 뿐이다. */
export interface FileAsset {
  id: ID
  originTaskId?: ID
  originSrId?: ID
  name: string
  mime: string
  size: number
  blob: Blob
  uploadedBy: ID
  uploadedAt: ISODate
  source: FileSource
  tags: string[]
  /** 같은 업무·같은 이름으로 다시 저장하면 1씩 증가 */
  version: number
  /** 이전 버전 파일. 버전 체인은 previousId를 따라간다 */
  previousId?: ID
  /** OpenWebUI Files API에 올린 파일 ID (서버 주소별 캐시). 같은 버전은 다시 올리지 않는다 */
  remoteIds?: Record<string, string>
}

export interface Note {
  id: ID
  taskId: ID
  authorId: ID
  content: string
  createdAt: ISODate
  attachmentIds: ID[]
}

export type SrStatus = 'draft' | 'submitted' | 'reviewing' | 'in_progress' | 'responded' | 'done' | 'rejected'
export const SR_STATUSES: SrStatus[] = ['draft', 'submitted', 'reviewing', 'in_progress', 'responded', 'done', 'rejected']

/** 담당자가 요청자에게 명시적으로 공유한 결과. 내부 대화는 노출되지 않는다. */
export interface SharedResult {
  id: ID
  taskId?: ID
  text: string
  fileIds: ID[]
  by: ID
  at: ISODate
}

/** 서비스 요청. draft = 접수 전 대화 중. 코드(SR-YYYY-NNNN)가 곧 태그가 된다. */
export interface ServiceRequest {
  id: ID
  code: string
  requesterId: ID
  title: string
  /** 제목 출처. manual이면 AI가 덮어쓰지 않는다 */
  titleSource: TitleSource
  body: string
  status: SrStatus
  attachmentIds: ID[]
  threadId: ID
  /** 요청자에게 공유된 결과 (없으면 빈 배열) */
  results: SharedResult[]
  submittedAt?: ISODate
  createdAt: ISODate
  updatedAt: ISODate
}

export type ActivityType =
  | 'task.created'
  | 'task.started'
  | 'task.completed'
  | 'task.reopened'
  | 'task.hold'
  | 'task.status_changed'
  | 'checklist.checked'
  | 'checklist.unchecked'
  | 'checklist.reviewed'
  | 'file.uploaded'
  | 'file.tagged_output'
  | 'input.selected'
  | 'input.removed'
  | 'context.selected'
  | 'context.removed'
  | 'context.refreshed'
  | 'note.added'
  | 'message.sent'
  | 'thread.created'
  | 'model.changed'
  | 'feedback.given'
  | 'tag.added'
  | 'tag.removed'
  | 'assistant.created'
  | 'assistant.updated'
  | 'assistant.status_changed'
  | 'assistant.reordered'
  | 'sr.created'
  | 'sr.submitted'
  | 'sr.status_changed'
  | 'sr.task_started'
  | 'sr.result_shared'

export interface ActivityLog {
  id: ID
  taskId?: ID
  assistantId?: ID
  srId?: ID
  userId: ID
  type: ActivityType
  payload: Record<string, unknown>
  at: ISODate
}

export type LlmMode = 'mock' | 'live'

/** 선택한 입력 파일을 assistant에 넘기는 방식. openwebui = Files API 첨부, inline = 텍스트를 프롬프트에 붙임 */
export type FileDelivery = 'inline' | 'openwebui'

export interface LlmSettings {
  mode: LlmMode
  baseUrl: string
  apiKey: string
  model: string
  /** 없으면 inline */
  fileDelivery?: FileDelivery
}

export interface Settings {
  id: 'app'
  currentUserId: ID
  /** SR 접수 대화에 쓰는 에이전트 (기본: URS 분석 도우미) */
  srIntakeAssistantId?: ID
  llm: LlmSettings
  /** 요청 본문 크기 한도(바이트). 없으면 DEFAULT_REQUEST_BUDGET_BYTES. 모델 토큰 한도와는 다르다 */
  requestBudgetBytes?: number
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  mode: 'mock',
  baseUrl: 'http://localhost:3000/api',
  apiKey: '',
  model: 'glm-5.2',
}

/** 인앱 알림. 업무 배정·SR 접수/상태 변경·결과 공유 시 대상 사용자에게 생성 */
export interface Notification {
  id: ID
  userId: ID
  title: string
  body: string
  /** 클릭 시 이동 경로 */
  link: string
  at: ISODate
  read: boolean
}
