import { inArray } from 'drizzle-orm'
import type { Assistant, FileAsset, Settings, Task, User } from '@mes/domain'
import type { LlmPorts } from '@mes/llm'
import type { AppConfig } from '../config/config.js'
import type { Db } from '../db/db.module.js'
import { appSetting, appUser, assistant, assistantChecklistTemplate, assistantExpectedIo, checklistItem, fileObject, task, taskAssignee, taskInput, taskTag, thread } from '../db/schema.js'
import { toLlmSettings } from './presets.js'

const iso = (date: Date) => date.toISOString()
const missing = (name: string): never => { throw new Error(`NotImplemented: ${name} (S2/S3)`) }

/** LLM prompt builder에서 필요한 S1 DB 읽기 어댑터. */
export class DbLlmPorts implements LlmPorts {
  constructor(private readonly db: Db, private readonly config: AppConfig, private readonly currentUserId: string) {}

  async getSettings(): Promise<Settings> {
    const rows = await this.db.select().from(appSetting)
    const values = new Map(rows.map((row) => [row.key, row.value]))
    const sr = values.get('srIntakeAssistantId')
    const budget = values.get('requestBudgetBytes')
    return {
      id: 'app', currentUserId: this.currentUserId,
      llm: toLlmSettings(this.config.llm),
      ...(typeof sr === 'string' ? { srIntakeAssistantId: sr } : {}),
      ...(typeof budget === 'number' ? { requestBudgetBytes: budget } : {}),
    }
  }

  async getUsers(): Promise<User[]> {
    const rows = await this.db.select().from(appUser)
    return rows.map((row) => ({ id: row.id, name: row.name, role: row.role, initials: row.initials, color: row.color, isSystemOwner: row.isSystemOwner }))
  }

  async getAssistants(): Promise<Assistant[]> {
    const [rows, io, templates] = await Promise.all([
      this.db.select().from(assistant),
      this.db.select().from(assistantExpectedIo),
      this.db.select().from(assistantChecklistTemplate),
    ])
    return rows.map((row) => ({
      id: row.id, name: row.name, level1: row.level1, level2: row.level2, summary: row.summary,
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
      this.db.select().from(task).where(inArray(task.id, ids)),
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
    const rows = await this.db.select().from(fileObject).where(inArray(fileObject.id, ids))
    const byId = new Map(rows.map((row): [string, FileAsset] => [row.id, {
      id: row.id, ...(row.originTaskId ? { originTaskId: row.originTaskId } : {}),
      ...(row.originSrId ? { originSrId: row.originSrId } : {}), name: row.originalName,
      mime: row.mime, size: row.sizeBytes, blob: new Blob([]), uploadedBy: row.uploadedBy,
      uploadedAt: iso(row.uploadedAt), source: row.source === 'assistant' ? 'assistant' : row.kind === 'sr_attachment' ? 'sr' : 'upload',
      tags: [], version: row.version, ...(row.previousId ? { previousId: row.previousId } : {}),
    }]))
    return ids.map((id) => byId.get(id))
  }

  async getServiceRequestsByCodes(): Promise<never> { return missing('getServiceRequestsByCodes') }
  async getFilesBySr(): Promise<never> { return missing('getFilesBySr') }
  async loadConversationInputs(): Promise<never> { return missing('loadConversationInputs') }
  async updateFileRemoteIds(): Promise<never> { return missing('updateFileRemoteIds') }
  async readFileBytes(): Promise<never> { return missing('readFileBytes') }
}
