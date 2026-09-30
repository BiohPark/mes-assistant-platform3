import { Inject, Injectable } from '@nestjs/common'
import type { Assistant, AssistantStats, CatalogCode, CatalogUser } from '@mes/contracts'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module.js'
import { appUser, assistant, assistantChecklistTemplate, assistantExpectedIo, code, task } from '../db/schema.js'

export interface CatalogReader {
  assistants(): Promise<Assistant[]>
  stats(): Promise<AssistantStats[]>
  users(): Promise<CatalogUser[]>
  codes(group?: string): Promise<CatalogCode[]>
}
export const CATALOG = Symbol('CATALOG')

@Injectable()
export class DbCatalogReader implements CatalogReader {
  constructor(@Inject(DB) private readonly db: Db) {}

  async assistants(): Promise<Assistant[]> {
    const [rows, codes, io, templates] = await Promise.all([
      this.db.select().from(assistant).orderBy(asc(assistant.sortOrder), asc(assistant.id)),
      this.db.select().from(code),
      this.db.select().from(assistantExpectedIo).orderBy(asc(assistantExpectedIo.sortOrder)),
      this.db.select().from(assistantChecklistTemplate).orderBy(asc(assistantChecklistTemplate.sortOrder)),
    ])
    const labels = new Map(codes.map((item) => [item.id, item.name]))
    return rows.map((row) => ({
      id: row.id, name: row.name, level1: labels.get(row.level1CodeId) ?? row.level1CodeId,
      level2: labels.get(row.level2CodeId) ?? row.level2CodeId,
      level1CodeId: row.level1CodeId, level2CodeId: row.level2CodeId,
      summary: row.summary, order: row.sortOrder, ...(row.modelId && { modelId: row.modelId }),
      ...(row.link1 && { link1: row.link1 }), ...(row.docUrl && { docUrl: row.docUrl }),
      expectedInputs: io.filter((item) => item.assistantId === row.id && item.direction === 'input').map((item) => item.label),
      expectedOutputs: io.filter((item) => item.assistantId === row.id && item.direction === 'output').map((item) => item.label),
      ownerId: row.ownerId, status: row.status as Assistant['status'], usageExample: row.usageExample,
      ...(row.imageFileId && { imageId: row.imageFileId }), color: row.color,
      checklistTemplate: templates.filter((item) => item.assistantId === row.id).map((item) => ({ id: item.id, label: item.label, required: item.required })),
      createdBy: row.createdBy, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), revision: row.revision,
    }))
  }

  async stats(): Promise<AssistantStats[]> {
    const rows = await this.db.select({
      assistantId: assistant.id,
      open: sql<number>`count(*) filter (where ${task.status} = 'todo')::int`,
      inProgress: sql<number>`count(*) filter (where ${task.status} = 'in_progress')::int`,
      onHold: sql<number>`count(*) filter (where ${task.status} = 'on_hold')::int`,
      done: sql<number>`count(*) filter (where ${task.status} = 'done')::int`,
    }).from(assistant).leftJoin(task, and(eq(task.assistantId, assistant.id), isNull(task.deletedAt))).groupBy(assistant.id).orderBy(asc(assistant.sortOrder))
    return rows
  }

  async users(): Promise<CatalogUser[]> {
    return this.db.select({
      id: appUser.id, name: appUser.name, initials: appUser.initials, color: appUser.color,
      isSystemOwner: appUser.isSystemOwner, isBusinessOwner: appUser.isBusinessOwner,
    }).from(appUser).where(eq(appUser.active, true)).orderBy(asc(appUser.name), asc(appUser.id))
  }

  async codes(group?: string): Promise<CatalogCode[]> {
    return this.db.select().from(code).where(group ? sql`${code.active} = true and ${code.groupKey} = ${group}` : eq(code.active, true)).orderBy(asc(code.sortOrder), asc(code.id))
  }
}
