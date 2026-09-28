import type { LlmPorts } from './ports.js'
import { resolveModel } from '@mes/domain'
import { DEFAULT_REQUEST_BUDGET_BYTES, byteLength, requestBytes } from '@mes/domain'
import { isSrTag } from '@mes/domain'
import type {
  Assistant,
  ConversationRequestInput,
  FileAsset,
  FileRequestInput,
  ID,
  InputWeight,
  Message,
  RequestInfo,
  ServiceRequest,
  Settings,
  Task,
  Thread,
} from '@mes/domain'
import {
  buildSrSystemPrompt,
  buildTaskSystemPrompt,
  readInputText,
  isTextFile,
  renderConversation,
  threadParticipants,
  toChatMessages,
  type PromptConversation,
  type PromptInput,
  type UserMap,
} from './context.js'
import { deliverFiles, usesFilesApi, type AttachedFile, type DeliverOptions } from './openwebuiFiles.js'
import type { ChatMessageInput, ChatMeta } from './provider.js'

/**
 * 요청 조립: 사람이 고른 입력(파일·참조 대화)만 담고, 입력마다 실제 전달 방식을 기록한다.
 * 화면의 "이번 요청에 사용" 트레이(dryRun)와 실제 전송이 같은 함수를 쓴다 — 미리 본 것이 곧 보내는 것.
 */

/** 채팅이 붙는 대상: 대화(=업무, 스레드 1개) 또는 SR 접수 대화 */
export type ChatScope = { kind: 'task'; task: Task; assistant: Assistant } | { kind: 'sr'; sr: ServiceRequest; intake: Assistant; files: FileAsset[] }

export interface BuildOptions {
  /** 이번 메시지에만 붙인 첨부 (대화 입력으로 고정하지 않음) */
  oneShotFileIds?: ID[]
  /** 첨부 실패 뒤 사용자가 "텍스트로 보내기"를 고른 파일 */
  forceInlineFileIds?: ID[]
  /** 크기 추정: OpenWebUI 업로드 없이 첨부 예정으로 계산 */
  dryRun?: boolean
  signal?: AbortSignal
  deadlineAt?: number
  onProgress?: DeliverOptions['onProgress']
}

export interface BuiltRequest {
  settings: Settings
  model: string
  messages: ChatMessageInput[]
  files?: AttachedFile[]
  meta: ChatMeta
  info: RequestInfo
  /** OpenWebUI 전달에 실패한 파일 — 있으면 요청을 보내지 않는다 */
  failed: FileRequestInput[]
}

interface FileEntry {
  file: FileAsset
  weight: InputWeight
  source?: string
  oneShot: boolean
}

const WEIGHT_MARK: Record<InputWeight, string> = { main: '★ 주 입력', reference: '☑ 참고' }

/** 선택한 입력(주 입력 먼저, 선택 순서 유지) + 이번 메시지 첨부. 출처 대화 표기를 붙인다. */
async function loadFileEntries(task: Task, oneShotIds: ID[], ports: LlmPorts): Promise<FileEntry[]> {
  const selected = [...task.inputs.filter((i) => i.weight === 'main'), ...task.inputs.filter((i) => i.weight !== 'main')]
  const extra = oneShotIds.filter((id) => !task.inputs.some((i) => i.fileId === id))
  const refs = [
    ...selected.map((i) => ({ fileId: i.fileId, weight: i.weight, oneShot: false })),
    ...extra.map((fileId) => ({ fileId, weight: 'reference' as const, oneShot: true })),
  ]
  const files = await ports.getFiles(refs.map((r) => r.fileId))
  const originIds = [...new Set(files.map((f) => f?.originTaskId).filter((id): id is ID => !!id && id !== task.id))]
  const origins = await ports.getTasks(originIds)
  const assistantNames = new Map((await ports.getAssistants()).map((a) => [a.id, a.name]))
  const label = new Map(origins.filter((t): t is Task => !!t).map((t) => [t.id, `${t.code} · ${assistantNames.get(t.assistantId) ?? t.assistantId}`]))
  return refs.flatMap((r, i): FileEntry[] => {
    const file = files[i]
    if (!file) return []
    const source = file.originTaskId === task.id ? '이 대화' : file.originSrId ? 'SR 첨부' : file.originTaskId ? label.get(file.originTaskId) : undefined
    return [{ file, weight: r.weight, source, oneShot: r.oneShot }]
  })
}

function firstLine(text?: string): string | undefined {
  const line = text?.split('\n').find((l) => l.trim())?.trim()
  return line ? line.slice(0, 40) : undefined
}

function fileLine(i: FileRequestInput, text?: string): string {
  const head = firstLine(text)
  return [`${WEIGHT_MARK[i.weight]} · ${i.name} v${i.version}`, i.source, i.oneShot ? '이번 메시지만' : undefined, head ? `첫 줄: "${head}"` : undefined]
    .filter(Boolean)
    .join(' · ')
}

function conversationLine(c: ConversationRequestInput): string {
  return `${WEIGHT_MARK[c.weight]} · 대화 ${c.code} (${c.assistantName}) · ${c.mode === 'summary' ? '요약' : `메시지 ${c.messageCount}개`}`
}

interface DeliveredFiles {
  prompt: PromptInput[]
  info: FileRequestInput[]
  attached?: AttachedFile[]
  lines: string[]
}

/** 파일별 전달 방식 결정 + (실제 전송 시) OpenWebUI 업로드·처리 대기 */
async function deliver(settings: Settings, entries: FileEntry[], opts: BuildOptions, ports: LlmPorts): Promise<DeliveredFiles> {
  const viaFilesApi = usesFilesApi(settings.llm)
  const forceInline = new Set(opts.forceInlineFileIds ?? [])
  const toAttach = viaFilesApi ? entries.filter((e) => !(forceInline.has(e.file.id) && isTextFile(e.file))) : []
  const result = toAttach.length && !opts.dryRun ? await deliverFiles(settings.llm, toAttach.map((e) => e.file), { signal: opts.signal, onProgress: opts.onProgress,
    processTimeoutMs: opts.deadlineAt === undefined ? undefined : Math.max(1, Math.min(300_000, opts.deadlineAt - Date.now())) }, ports) : undefined
  const failedReason = new Map(result?.failed.map((f) => [f.file.id, f.reason]) ?? [])
  const attachIds = new Set(toAttach.map((e) => e.file.id))

  const prompt: PromptInput[] = []
  const info: FileRequestInput[] = []
  const lines: string[] = []
  for (const e of entries) {
    const text = await readInputText(e.file, ports)
    const base = { kind: 'file' as const, fileId: e.file.id, name: e.file.name, version: e.file.version, weight: e.weight, source: e.source, oneShot: e.oneShot, text: text !== undefined }
    let item: FileRequestInput
    if (attachIds.has(e.file.id)) {
      const reason = failedReason.get(e.file.id)
      item = reason
        ? { ...base, delivery: 'failed', bytes: 0, error: reason }
        : { ...base, delivery: 'attached', bytes: 0, remoteId: result?.attached.get(e.file.id)?.id }
      prompt.push({ file: e.file, weight: e.weight, source: e.source, attached: true })
    } else {
      item = { ...base, delivery: text !== undefined ? 'inline' : 'metadata_only', bytes: text !== undefined ? byteLength(text) : 0 }
      prompt.push({ file: e.file, weight: e.weight, source: e.source, text })
    }
    info.push(item)
    lines.push(fileLine(item, text))
  }
  // files[]는 입력 순서(주 입력 → 참고 → 이번 메시지)를 따른다
  const attached = viaFilesApi
    ? info.filter((i) => i.delivery === 'attached').map((i): AttachedFile => ({ type: 'file', id: i.remoteId ?? `pending:${i.fileId}` }))
    : undefined
  return { prompt, info, attached: attached?.length ? attached : undefined, lines }
}

async function loadConversations(taskId: ID, users: UserMap, ports: LlmPorts): Promise<{ prompt: PromptConversation[]; info: ConversationRequestInput[] }> {
  const loaded = await ports.loadConversationInputs(taskId)
  const prompt: PromptConversation[] = []
  const info: ConversationRequestInput[] = []
  for (const l of loaded) {
    const pc: PromptConversation = {
      weight: l.input.weight,
      code: l.source.code,
      title: l.source.title,
      assistantName: l.assistant?.name ?? l.source.assistantId,
      mode: l.snapshot.mode,
      selectedAt: l.snapshot.createdAt,
      messages: l.messages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        author: m.role === 'user' && m.authorId ? users.get(m.authorId)?.name : undefined,
        content: m.content,
      })),
      summaryText: l.snapshot.summaryText,
    }
    prompt.push(pc)
    info.push({
      kind: 'conversation',
      sourceTaskId: l.source.id,
      code: l.source.code,
      title: l.source.title,
      assistantName: pc.assistantName,
      weight: pc.weight,
      mode: pc.mode,
      snapshotId: l.snapshot.id,
      messageCount: l.messages.length,
      bytes: byteLength(renderConversation(pc)),
    })
  }
  return { prompt, info }
}

async function buildTaskRequest(scope: Extract<ChatScope, { kind: 'task' }>, settings: Settings, users: UserMap, history: Message[], opts: BuildOptions, ports: LlmPorts) {
  // 전송 시점의 최신 대화 상태로 만든다 (입력 선택이 방금 바뀌었을 수 있음)
  const task = (await ports.getTask(scope.task.id)) ?? scope.task
  const srCodes = task.tags.filter(isSrTag)
  const [entries, conversations, linkedSrs] = await Promise.all([
    loadFileEntries(task, opts.oneShotFileIds ?? [], ports),
    loadConversations(task.id, users, ports),
    srCodes.length ? ports.getServiceRequestsByCodes(srCodes) : Promise.resolve([]),
  ])
  const files = await deliver(settings, entries, opts, ports)
  const systemPrompt = await buildTaskSystemPrompt({
    assistant: scope.assistant,
    task,
    linkedSrs,
    inputs: files.prompt,
    conversations: conversations.prompt,
    participants: threadParticipants(history, users),
  }, ports)
  return {
    task,
    systemPrompt,
    srCodes,
    files,
    inputs: [...files.info, ...conversations.info],
    lines: [...files.lines, ...conversations.info.map(conversationLine)],
  }
}

async function buildSrRequest(scope: Extract<ChatScope, { kind: 'sr' }>, ports: LlmPorts) {
  // 첨부는 보내는 시점에 다시 읽는다 (화면이 가진 목록은 방금 올린 파일을 모를 수 있다)
  const files = await ports.getFilesBySr(scope.sr.id)
  const info: FileRequestInput[] = []
  const lines: string[] = []
  for (const f of files) {
    const text = await readInputText(f, ports)
    const item: FileRequestInput = {
      kind: 'file',
      fileId: f.id,
      name: f.name,
      version: f.version,
      weight: 'reference',
      source: 'SR 첨부',
      delivery: text !== undefined ? 'inline' : 'metadata_only',
      text: text !== undefined,
      bytes: text !== undefined ? byteLength(text) : 0,
    }
    info.push(item)
    lines.push(fileLine(item, text))
  }
  return { systemPrompt: await buildSrSystemPrompt({ intake: scope.intake, sr: scope.sr, files }, ports), files, info, lines }
}

/**
 * 채팅 요청 조립. history는 이번 요청에 포함할 스레드 메시지(마지막 사용자 메시지까지).
 * OpenWebUI 전달 실패는 failed로 돌려주며, 호출 측은 요청을 보내지 않는다.
 */
export async function buildChatRequest(scope: ChatScope, thread: Thread, history: Message[], opts: BuildOptions = {}, ports: LlmPorts): Promise<BuiltRequest> {
  const settings = await ports.getSettings()
  const users: UserMap = new Map((await ports.getUsers()).map((u) => [u.id, { name: u.name, role: u.role }]))
  const limitBytes = settings.requestBudgetBytes ?? DEFAULT_REQUEST_BUDGET_BYTES
  const transport = usesFilesApi(settings.llm) && scope.kind === 'task' ? 'openwebui' : 'inline'

  if (scope.kind === 'sr') {
    const sr = await buildSrRequest(scope, ports)
    const model = resolveModel({ thread, assistant: scope.intake, settings: settings.llm }).modelId
    const messages = toChatMessages(sr.systemPrompt, history, users)
    return {
      settings,
      model,
      messages,
      meta: { assistantId: scope.intake.id, assistantLevel2: scope.intake.level2, assistantName: scope.intake.name, srIntake: true, inputFileNames: sr.files.map((f) => f.name), usedInputs: sr.lines },
      info: { at: new Date().toISOString(), provider: settings.llm.mode, transport, model, bytes: requestBytes({ model, messages }), limitBytes, inputs: sr.info, srCodes: scope.sr.code ? [scope.sr.code] : [] },
      failed: [],
    }
  }

  const built = await buildTaskRequest(scope, settings, users, history, opts, ports)
  const model = resolveModel({ thread, task: built.task, assistant: scope.assistant, settings: settings.llm }).modelId
  const messages = toChatMessages(built.systemPrompt, history, users)
  const files = built.files.attached
  return {
    settings,
    model,
    messages,
    files,
    meta: {
      assistantId: scope.assistant.id,
      assistantLevel2: scope.assistant.level2,
      assistantName: scope.assistant.name,
      taskTitle: built.task.title,
      inputFileNames: built.files.info.map((i) => i.name),
      usedInputs: built.lines,
    },
    info: {
      at: new Date().toISOString(),
      provider: settings.llm.mode,
      transport,
      model,
      bytes: requestBytes({ model, messages }),
      limitBytes,
      inputs: built.inputs,
      srCodes: built.srCodes,
    },
    failed: built.files.info.filter((i) => i.delivery === 'failed'),
  }
}
