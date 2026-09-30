import { createHash } from 'node:crypto'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { Assistant, FileAsset, ServiceRequest, Settings, Task, User } from '@mes/domain'
import type { LlmPorts } from '@mes/llm'
import { remoteKey } from '@mes/llm'
import type { AppConfig } from '../config/config.js'
import type { Db } from '../db/db.module.js'
import { appSetting, appUser, assistant, assistantChecklistTemplate, assistantExpectedIo, code, checklistItem, fileObject, fileRemoteRef, serviceRequest, task, taskAssignee, taskInput, taskTag, thread } from '../db/schema.js'
import { FileStorageService } from '../files/fileStorage.service.js'
import { toLlmSettings } from './presets.js'
import { DbConversationInputsService } from '../context/conversation-inputs.service.js'

const iso = (date: Date) => date.toISOString()
const missing = (name: string): never => { throw new Error(`NotImplemented: ${name} (S2/S3)`) }
const scopeHash = (key: string) => createHash('sha256').update(key).digest('hex')

/** LLM prompt builder에서 필요한 S1 DB 읽기 어댑터. */
export class DbLlmPorts implements LlmPorts {
  private readonly storageKeys = new Map<string, string>()
  constructor(private readonly db: Db, private readonly config: AppConfig, private readonly currentUserId: string, private readonly storage = new FileStorageService(config.fileStorageRoot)) {}

  async getSettings(): Promise<Settings> {
    const rows = await this.db.select().from(appSetting)
    const values = new Map(rows.map((row) => [row.key, row.value]))
    const sr = values.get('srIntakeAssistantId')
    const budget = values.get('requestBudgetBytes')
    return {
      id: 'app', currentUserId: this.currentUserId,
      llm: toLlmSettings(this.config.llm),
      ...(typeof sr === 'string' ? { srIntakeAssistantId: sr } : {}),
      requestBudgetBytes: typeof budget === 'number' ? budget : this.config.request.budgetBytes,
    }
  }

  async getUsers(): Promise<User[]> {
    const rows = await this.db.select().from(appUser)
    return rows.map((row) => ({ id: row.id, name: row.name, role: row.role, initials: row.initials, color: row.color, isSystemOwner: row.isSystemOwner }))
  }

  async getAssistants(): Promise<Assistant[]> {
    const [rows, io, templates, codes] = await Promise.all([
      this.db.select().from(assistant),
      this.db.select().from(assistantExpectedIo),
      this.db.select().from(assistantChecklistTemplate),
      this.db.select().from(code),
    ])
    const labels = new Map(codes.map((item) => [item.id, item.name]))
    return rows.map((row) => ({
      id: row.id, name: row.name, level1: labels.get(row.level1CodeId) ?? row.level1CodeId, level2: labels.get(row.level2CodeId) ?? row.level2CodeId,
      level1CodeId: row.level1CodeId, level2CodeId: row.level2CodeId, summary: row.summary,
      order: row.sortOrder, ...(row.modelId ? { modelId: row.modelId } : {}),
      ...(row.link1 ? { link1: row.link1 } : {}), ...(row.docUrl ? { docUrl: row.docUrl } : {}),
      expectedInputs: io.filter((item) => item.assistantId === row.id && item.direction === 'input').sort((a, b) => a.sortOrder - b.sortOrder).map((item) => item.label),
      expectedOutputs: io.filter((item) => item.assistantId === row.id && item.direction === 'output').sort((a, b) => a.sortOrder - b.sortOrder).map((item) => item.label),
      ownerId: row.ownerId, status: row.status as Assistant['status'], usageExample: row.usageExample,
      ...(row.imageFileId ? { imageId: row.imageFileId } : {}), color: row.color,
      checklistTemplate: templates.filter((item) => item.assistantId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map((item) => ({ id: item.id, label: item.label, required: item.required })),
      createdBy: row.createdBy, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
    }))
  }

  async getTask(id: string): Promise<Task | undefined> { return (await this.getTasks([id]))[0] }

  async getTasks(ids: string[]): Promise<(Task | undefined)[]> {
    if (!ids.length) return []
    const [rows, assignees, tags, inputs, checks, threads, outputs] = await Promise.all([
      this.db.select().from(task).where(and(inArray(task.id, ids), isNull(task.deletedAt))),
      this.db.select().from(taskAssignee).where(inArray(taskAssignee.taskId, ids)),
      this.db.select().from(taskTag).where(inArray(taskTag.taskId, ids)),
      this.db.select().from(taskInput).where(inArray(taskInput.taskId, ids)),
      this.db.select().from(checklistItem).where(inArray(checklistItem.taskId, ids)),
      this.db.select().from(thread).where(inArray(thread.taskId, ids)),
      this.db.select({ id: fileObject.id, taskId: fileObject.originTaskId, isOutput: fileObject.isOutput, deletedAt: fileObject.deletedAt }).from(fileObject).where(inArray(fileObject.originTaskId, ids)),
    ])
    const byId = new Map(rows.map((row): [string, Task] => [row.id, {
      id: row.id, code: row.code, assistantId: row.assistantId, title: row.title,
      titleSource: row.titleSource as Task['titleSource'], summary: row.summary,
      status: row.status as Task['status'], ownerId: row.ownerId,
      assigneeIds: assignees.filter((item) => item.taskId === row.id).map((item) => item.userId),
      priority: row.priority as Task['priority'], ...(row.dueDate ? { dueDate: row.dueDate } : {}),
      tags: tags.filter((item) => item.taskId === row.id).map((item) => item.tagKey),
      checklist: checks.filter((item) => item.taskId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map((item) => ({
        id: item.id, label: item.label, required: item.required, checked: item.checked,
        ...(item.checkedBy ? { checkedBy: item.checkedBy } : {}), ...(item.checkedAt ? { checkedAt: iso(item.checkedAt) } : {}),
      })),
      inputs: inputs.filter((item) => item.taskId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map((item) => ({ fileId: item.fileId, weight: item.weight as 'main' | 'reference', selectedAt: iso(item.selectedAt), selectedBy: item.selectedBy })),
      outputFileIds: outputs.filter((item) => item.taskId === row.id && item.isOutput && !item.deletedAt).map((item) => item.id),
      ...(threads.find((item) => item.taskId === row.id) ? { threadId: threads.find((item) => item.taskId === row.id)!.id } : {}),
      ...(row.modelId ? { modelId: row.modelId } : {}), createdAt: iso(row.createdAt), createdBy: row.createdBy,
      lastActivityAt: iso(row.lastActivityAt), ...(row.startedAt ? { startedAt: iso(row.startedAt) } : {}),
      ...(row.completedAt ? { completedAt: iso(row.completedAt) } : {}), ...(row.completedBy ? { completedBy: row.completedBy } : {}),
    }]))
    return ids.map((id) => byId.get(id))
  }

  async getFiles(ids: string[]): Promise<(FileAsset | undefined)[]> {
    if (!ids.length) return []
    const rows = await this.db.select({ file: fileObject }).from(fileObject).leftJoin(task, eq(fileObject.originTaskId, task.id))
      .where(and(inArray(fileObject.id, ids), isNull(fileObject.deletedAt), or(isNull(fileObject.originTaskId), isNull(task.deletedAt))))
    const visible = rows.map((item) => item.file)
    for (const row of visible) this.storageKeys.set(row.id, row.storageKey)
    const refs = await this.db.select().from(fileRemoteRef).where(inArray(fileRemoteRef.fileId, ids))
    const currentKey = remoteKey(toLlmSettings(this.config.llm))
    const currentHash = scopeHash(currentKey)
    const byId = new Map(visible.map((row): [string, FileAsset] => [row.id, {
      id: row.id, ...(row.originTaskId ? { originTaskId: row.originTaskId } : {}),
      ...(row.originSrId ? { originSrId: row.originSrId } : {}), name: row.originalName,
      mime: row.mime, size: row.sizeBytes, blob: new Blob([]), uploadedBy: row.uploadedBy,
      uploadedAt: iso(row.uploadedAt), source: row.source === 'assistant' ? 'assistant' : row.kind === 'sr_attachment' ? 'sr' : 'upload',
      tags: [], version: row.version, ...(row.previousId ? { previousId: row.previousId } : {}),
      ...(refs.find((ref) => ref.fileId === row.id && ref.scopeHash === currentHash) ? { remoteIds: { [currentKey]: refs.find((ref) => ref.fileId === row.id && ref.scopeHash === currentHash)!.remoteId } } : {}),
    }]))
    return ids.map((id) => byId.get(id))
  }

  async getServiceRequestsByCodes(codes: string[]): Promise<ServiceRequest[]> {
    if (!codes.length) return []
    const rows = await this.db.select().from(serviceRequest).where(inArray(serviceRequest.code, codes))
    const threads = await this.db.select().from(thread).where(inArray(thread.srId, rows.map((row) => row.id)))
    const files = await this.db.select({ id: fileObject.id, srId: fileObject.originSrId }).from(fileObject).where(and(inArray(fileObject.originSrId, rows.map((row) => row.id)), isNull(fileObject.deletedAt)))
    return rows.map((row) => ({ id: row.id, code: row.code ?? '', requesterId: row.requesterId, title: row.title,
      titleSource: row.titleSource as ServiceRequest['titleSource'], body: row.body, status: row.status as ServiceRequest['status'],
      attachmentIds: files.filter((file) => file.srId === row.id).map((file) => file.id), threadId: threads.find((item) => item.srId === row.id)?.id ?? '',
      results: [], ...(row.submittedAt ? { submittedAt: iso(row.submittedAt) } : {}), createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }))
  }
  async getFilesBySr(srId: string): Promise<FileAsset[]> {
    const rows = await this.db.select({ id: fileObject.id }).from(fileObject).where(and(eq(fileObject.originSrId, srId), isNull(fileObject.deletedAt)))
    return (await this.getFiles(rows.map((row) => row.id))).filter((file): file is FileAsset => !!file)
  }
  async loadConversationInputs(taskId: string) {
    const loaded = await new DbConversationInputsService(this.db).load(taskId)
    const sources = await this.getTasks(loaded.map((item) => item.input.sourceTaskId))
    const assistants = await this.getAssistants()
    return loaded.flatMap((item, index) => {
      const source = sources[index]
      if (!source) return []
      return [{ input: item.input, snapshot: item.snapshot, source,
        assistant: assistants.find((agent) => agent.id === source.assistantId), messages: item.messages }]
    })
  }
  async updateFileRemoteIds(fileId: string, remoteIds: Record<string, string>): Promise<void> {
    const key = remoteKey(toLlmSettings(this.config.llm))
    const remoteId = remoteIds[key]
    if (remoteId) await this.db.insert(fileRemoteRef).values({ fileId, scopeHash: scopeHash(key), remoteId })
      .onDuplicateKeyUpdate({ set: { remoteId, uploadedAt: new Date() } })
  }
  async readFileBytes(file?: FileAsset): Promise<Uint8Array> {
    if (!file) return missing('readFileBytes')
    const key = this.storageKeys.get(file.id)
    if (key) return this.storage.read(key)
    const [row] = await this.db.select({ storageKey: fileObject.storageKey }).from(fileObject).where(eq(fileObject.id, file.id))
    if (!row) throw new Error('파일이 없습니다')
    return this.storage.read(row.storageKey)
  }
}
