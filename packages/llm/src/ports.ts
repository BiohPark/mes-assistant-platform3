import type { Assistant, ConversationInput, ContextSnapshot, FileAsset, ID, Message, ServiceRequest, Settings, Task, User } from '@mes/domain'

export interface LoadedConversationInput {
  input: ConversationInput
  snapshot: ContextSnapshot
  source: Task
  assistant?: Assistant
  messages: Message[]
}

/** Storage and file bytes supplied by the host application. */
export interface LlmPorts {
  getSettings(): Promise<Settings>
  getTask(id: ID): Promise<Task | undefined>
  getFiles(ids: ID[]): Promise<(FileAsset | undefined)[]>
  getTasks(ids: ID[]): Promise<(Task | undefined)[]>
  getAssistants(): Promise<Assistant[]>
  getUsers(): Promise<User[]>
  getServiceRequestsByCodes(codes: string[]): Promise<ServiceRequest[]>
  getFilesBySr(srId: ID): Promise<FileAsset[]>
  loadConversationInputs(taskId: ID): Promise<LoadedConversationInput[]>
  updateFileRemoteIds(fileId: ID, remoteIds: Record<string, string>): Promise<void>
  readFileBytes(file: FileAsset): Promise<Uint8Array>
}
