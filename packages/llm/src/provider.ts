export interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  name?: string
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessageInput[]
  tools?: ToolDefinition[]
  signal?: AbortSignal
  /** Mock 응답 선택용 힌트 (실제 provider는 무시) */
  meta?: ChatMeta
  /** OpenWebUI Files API로 올린 첨부 (OpenWebUI 확장 파라미터) */
  files?: Array<{ type: 'file'; id: string }>
}

export interface ChatMeta {
  assistantId?: string
  assistantLevel2?: string
  assistantName?: string
  taskTitle?: string
  inputFileNames?: string[]
  /** 사용한 자료 요약 한 줄씩 (Mock 응답이 "사용한 자료" 블록으로 드러낸다) */
  usedInputs?: string[]
  systemAssistant?: boolean
  srIntake?: boolean
}

export type ChatChunk =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface ChatProvider {
  readonly kind: 'mock' | 'live'
  stream(req: ChatRequest): AsyncIterable<ChatChunk>
  /** 연결 확인. 실패 시 이유 반환 */
  ping(): Promise<{ ok: boolean; detail: string }>
  /** 사용 가능한 모델 ID 목록 (실패 시 빈 배열) */
  listModels(): Promise<string[]>
}
