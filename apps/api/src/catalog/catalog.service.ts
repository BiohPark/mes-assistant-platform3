import { Inject, Injectable } from '@nestjs/common'
import type { Assistant, AssistantStats, CatalogCode, CatalogUser } from '@mes/contracts'
import { alias } from 'drizzle-orm/mysql-core'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { classificationView } from '../db/classifications.js'
import { DB, type Db } from '../db/db.module.js'
import { appUser, assistant, assistantChecklistTemplate, assistantClassification, assistantExpectedIo, code, task } from '../db/schema.js'

export interface CatalogReader {
  assistants(): Promise<Assistant[]>
  stats(): Promise<AssistantStats[]>
  users(): Promise<CatalogUser[]>
  codes(group?: string, includeInactive?: boolean): Promise<CatalogCode[]>
}
export const CATALOG = Symbol('CATALOG')

@Injectable()
export class DbCatalogReader implements CatalogReader {
  constructor(@Inject(DB) private readonly db: Db) {}

  async assistants(): Promise<Assistant[]> {
    const level1 = alias(code, 'classification_level1')
    const level2 = alias(code, 'classification_level2')
    // Parent and paths must share one statement snapshot under READ COMMITTED.
    const [joined, io, templates] = await Promise.all([
      this.db.select({ row: assistant, path: assistantClassification, level1: level1.name, level2: level2.name }).from(assistant)
        .leftJoin(assistantClassification, eq(assistantClassification.assistantId, assistant.id))
        .leftJoin(level1, eq(level1.id, assistantClassification.level1CodeId))
        .leftJoin(level2, eq(level2.id, assistantClassification.level2CodeId))
        .orderBy(asc(assistant.sortOrder), asc(assistant.id), asc(assistantClassification.sortOrder)),
      this.db.select().from(assistantExpectedIo).orderBy(asc(assistantExpectedIo.sortOrder)),
      this.db.select().from(assistantChecklistTemplate).orderBy(asc(assistantChecklistTemplate.sortOrder)),
    ])
    const rows = [...new Map(joined.map(item => [item.row.id, item.row])).values()]
    const labels = new Map(joined.flatMap(item => item.path ? [
      [item.path.level1CodeId, item.level1 ?? item.path.level1CodeId] as const,
      [item.path.level2CodeId, item.level2 ?? item.path.level2CodeId] as const,
    ] : []))
    return rows.map((row) => {
      const paths = joined.flatMap(item => item.row.id === row.id && item.path ? [item.path] : [])
      const classifications = classificationView(paths, labels)
      return {
        id: row.id, name: row.name, classifications, ...classifications[0]!,
        summary: row.summary, order: row.sortOrder, ...(row.modelId && { modelId: row.modelId }),
        ...(row.link1 && { link1: row.link1 }), ...(row.docUrl && { docUrl: row.docUrl }),
        expectedInputs: io.filter((item) => item.assistantId === row.id && item.direction === 'input').map((item) => item.label),
        expectedOutputs: io.filter((item) => item.assistantId === row.id && item.direction === 'output').map((item) => item.label),
        ownerId: row.ownerId, status: row.status as Assistant['status'], usageExample: row.usageExample,
        ...(row.imageFileId && { imageId: row.imageFileId }), color: row.color,
        checklistTemplate: templates.filter((item) => item.assistantId === row.id).map((item) => ({ id: item.id, label: item.label, required: item.required })),
        createdBy: row.createdBy, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), revision: row.revision,
      }
    })
  }

  async stats(): Promise<AssistantStats[]> {
    const rows = await this.db.select({
      assistantId: assistant.id,
      open: sql<number>`count(case when ${task.status} = 'todo' then 1 end)`,
      inProgress: sql<number>`count(case when ${task.status} = 'in_progress' then 1 end)`,
      onHold: sql<number>`count(case when ${task.status} = 'on_hold' then 1 end)`,
      done: sql<number>`count(case when ${task.status} = 'done' then 1 end)`,
    }).from(assistant).leftJoin(task, and(eq(task.assistantId, assistant.id), isNull(task.deletedAt))).groupBy(assistant.id).orderBy(asc(assistant.sortOrder))
    return rows
  }

  async users(): Promise<CatalogUser[]> {
    return this.db.select({
      id: appUser.id, name: appUser.name, initials: appUser.initials, color: appUser.color,
      isSystemOwner: appUser.isSystemOwner, isBusinessOwner: appUser.isBusinessOwner,
    }).from(appUser).where(eq(appUser.active, true)).orderBy(asc(appUser.name), asc(appUser.id))
  }

  async codes(group?: string, includeInactive = false): Promise<CatalogCode[]> {
    return this.db.select().from(code).where(and(group ? eq(code.groupKey, group) : undefined, includeInactive ? undefined : eq(code.active, true))).orderBy(asc(code.sortOrder), asc(code.id))
  }
}
