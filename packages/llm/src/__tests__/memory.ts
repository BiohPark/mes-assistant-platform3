import type { Assistant, ConversationInput, ContextSnapshot, FileAsset, ID, InputWeight, Message, ServiceRequest, Settings, Task, Thread, User } from '@mes/domain'
import type { LlmPorts, LoadedConversationInput } from '../ports.js'

let next = 0
const id = (prefix: string) => `${prefix}${++next}`
const stamp = () => new Date(Date.now() + next).toISOString()

class Table<T extends { id: string }> {
  readonly items = new Map<string, T>()
  async add(value: T): Promise<void> { this.items.set(value.id, value) }
  async put(value: T): Promise<void> { this.items.set(value.id, value) }
  async get(key: string): Promise<T | undefined> { return this.items.get(key) }
  async clear(): Promise<void> { this.items.clear(); next = 0 }
  async bulkPut(values: T[]): Promise<void> { values.forEach((value) => this.items.set(value.id, value)) }
  async update(key: string, patch: Partial<T>): Promise<void> {
    const old = this.items.get(key)
    if (old) this.items.set(key, { ...old, ...patch })
  }
  where(field: keyof T) {
    return { equals: (value: unknown) => ({ sortBy: async (order: keyof T) =>
      [...this.items.values()].filter((item) => item[field] === value).sort((a, b) => String(a[order]).localeCompare(String(b[order]))) }) }
  }
}

const files = new Table<FileAsset>()
const tasks = new Table<Task>()
const assistants = new Table<Assistant>()
const threads = new Table<Thread>()
const messages = new Table<Message>()
const users = new Table<User>()
const settings = new Table<Settings>()
const serviceRequests = new Table<ServiceRequest>()
const conversationInputs = new Table<ConversationInput>()
const snapshots = new Table<ContextSnapshot>()
export const db = { files, tasks, assistants, threads, messages, users, settings, serviceRequests,
  tables: [files, tasks, assistants, threads, messages, users, settings, serviceRequests, conversationInputs, snapshots] }

export const ports: LlmPorts = {
  getSettings: async () => (await settings.get('app'))!,
  getTask: (key) => tasks.get(key),
  getFiles: async (keys) => Promise.all(keys.map((key) => files.get(key))),
  getTasks: async (keys) => Promise.all(keys.map((key) => tasks.get(key))),
  getAssistants: async () => [...assistants.items.values()],
  getUsers: async () => [...users.items.values()],
  getServiceRequestsByCodes: async (codes) => [...serviceRequests.items.values()].filter((sr) => codes.includes(sr.code)),
  getFilesBySr: async (srId) => [...files.items.values()].filter((file) => file.originSrId === srId).sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt)),
  loadConversationInputs: async (taskId): Promise<LoadedConversationInput[]> => {
    const out: LoadedConversationInput[] = []
    for (const input of conversationInputs.items.values()) {
      if (input.taskId !== taskId) continue
      const snapshot = (await snapshots.get(input.snapshotId))!
      const source = (await tasks.get(input.sourceTaskId))!
      out.push({ input, snapshot, source, assistant: await assistants.get(source.assistantId),
        messages: snapshot.messageIds.map((key) => messages.items.get(key)!).filter(Boolean) })
    }
    return out
  },
  updateFileRemoteIds: async (fileId, remoteIds) => files.update(fileId, { remoteIds }),
  readFileBytes: async (file) => new Uint8Array(await file.blob.arrayBuffer()),
}

export async function createAssistant(actor: { userId: ID }, input: Partial<Assistant> & Pick<Assistant, 'id' | 'name'>): Promise<Assistant> {
  const assistant = { ...input, ownerId: actor.userId } as Assistant
  await assistants.add(assistant)
  return assistant
}

export async function startConversation(actor: { userId: ID }, input: { assistantId: ID; tags?: string[] }): Promise<{ task: Task; thread: Thread }> {
  const taskId = id('task')
  const threadId = id('thread')
  const thread = { id: threadId, taskId, title: '', createdAt: stamp(), createdBy: actor.userId, archived: false } as Thread
  const task = { id: taskId, code: `WK-2026-${String(next).padStart(4, '0')}`, assistantId: input.assistantId, title: '', titleSource: 'default',
    summary: '', status: 'todo', ownerId: actor.userId, assigneeIds: [], priority: 'normal', tags: input.tags ?? [], checklist: [], inputs: [],
    outputFileIds: [], threadId, createdAt: stamp(), createdBy: actor.userId, lastActivityAt: stamp() } as Task
  await tasks.add(task)
  await threads.add(thread)
  return { task, thread }
}

export async function uploadFile(actor: { userId: ID }, origin: { taskId?: ID; srId?: ID }, file: File): Promise<FileAsset> {
  const value = { id: id('file'), originTaskId: origin.taskId, originSrId: origin.srId, name: file.name, mime: file.type, size: file.size,
    blob: file, uploadedBy: actor.userId, uploadedAt: stamp(), source: origin.srId ? 'sr' : 'upload', tags: [], version: 1 } as FileAsset
  await files.add(value)
  return value
}

export async function setInput(actor: { userId: ID }, taskId: ID, fileId: ID, weight: InputWeight): Promise<void> {
  const task = (await tasks.get(taskId))!
  task.inputs.push({ fileId, weight, selectedAt: stamp(), selectedBy: actor.userId })
}

export async function appendMessage(actor: { userId: ID } | null, threadId: ID, role: 'user' | 'assistant', content: string, attachmentIds: ID[] = []): Promise<Message> {
  const value = { id: id('message'), threadId, role, content, authorId: actor?.userId, createdAt: stamp(), attachmentIds, status: 'done' } as Message
  await messages.add(value)
  return value
}

export async function selectConversation(actor: { userId: ID }, taskId: ID, sourceTaskId: ID, opts: { weight?: InputWeight } = {}): Promise<void> {
  const source = (await tasks.get(sourceTaskId))!
  const selected = [...messages.items.values()].filter((message) => message.threadId === source.threadId)
  const snapshot = { id: id('snapshot'), sourceTaskId, mode: 'full', messageIds: selected.map((message) => message.id), createdBy: actor.userId, createdAt: stamp() } as ContextSnapshot
  await snapshots.add(snapshot)
  await conversationInputs.add({ id: id('input'), taskId, sourceTaskId, weight: opts.weight ?? 'reference', mode: 'full', snapshotId: snapshot.id,
    selectedAt: stamp(), selectedBy: actor.userId })
}

export async function startSrConversation(actor: { userId: ID }): Promise<ServiceRequest> {
  const srId = id('sr')
  const threadId = id('thread')
  const sr = { id: srId, code: '', requesterId: actor.userId, title: '', titleSource: 'default', body: '', status: 'draft',
    attachmentIds: [], threadId, results: [], createdAt: stamp(), updatedAt: stamp() } as ServiceRequest
  await serviceRequests.add(sr)
  await threads.add({ id: threadId, srId, title: '', createdAt: stamp(), createdBy: actor.userId, archived: false })
  return sr
}
