import { pathToFileURL } from 'node:url'
import { drizzle } from 'drizzle-orm/mysql2'
import type { Db } from './db.module.js'
import { createPool } from './connection.js'
import { isDuplicateKey } from './errors.js'
import { appUser, assistant, assistantChecklistTemplate, assistantExpectedIo, code, codeGroup } from './schema.js'
import { SEED_ASSISTANTS } from './seedData.js'

async function insertUnlessDuplicate(insert: () => Promise<unknown>): Promise<boolean> {
  try { await insert(); return true } catch (error) {
    if (isDuplicateKey(error)) return false
    throw error
  }
}

/** 개발·E2E 카탈로그만 추가한다. 기존 항목은 수정하지 않는다. */
export async function seedCatalog(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const group of [
      { key: 'assistant_level1', name: '업무 Lv1', sortOrder: 1 },
      { key: 'assistant_level2', name: '업무 Lv2', sortOrder: 2 },
    ]) await insertUnlessDuplicate(() => tx.insert(codeGroup).values(group))
    const levels = [
      ...new Set(SEED_ASSISTANTS.map((item) => item.level1CodeId)),
      ...new Set(SEED_ASSISTANTS.map((item) => item.level2CodeId)),
    ]
    for (const [sortOrder, id] of levels.entries()) {
      const [groupKey, name] = id.split(':', 2) as [string, string]
      await insertUnlessDuplicate(() => tx.insert(code).values({ id, groupKey, code: name, name, sortOrder }))
    }
    await insertUnlessDuplicate(() => tx.insert(appUser).values({
      id: 'seed-system', name: '시스템', initials: '시', color: '#64748b', active: false,
    }))
    for (const item of SEED_ASSISTANTS) {
      const inserted = await insertUnlessDuplicate(() => tx.insert(assistant).values({
        id: item.id, name: item.name, level1CodeId: item.level1CodeId, level2CodeId: item.level2CodeId,
        summary: item.summary, sortOrder: item.order, modelId: item.modelId, link1: item.link1,
        docUrl: item.docUrl, ownerId: item.ownerId, status: item.status, usageExample: item.usageExample,
        imageFileId: item.imageId, color: item.color, revision: item.revision, createdBy: item.createdBy,
        createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt),
      }))
      if (!inserted) continue
      for (const [sortOrder, label] of item.expectedInputs.entries()) {
        await tx.insert(assistantExpectedIo).values({ assistantId: item.id, direction: 'input', sortOrder, label })
      }
      for (const [sortOrder, label] of item.expectedOutputs.entries()) {
        await tx.insert(assistantExpectedIo).values({ assistantId: item.id, direction: 'output', sortOrder, label })
      }
      for (const [sortOrder, template] of item.checklistTemplate.entries()) {
        await tx.insert(assistantChecklistTemplate).values({ id: template.id, assistantId: item.id, sortOrder, label: template.label, required: template.required })
      }
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.NODE_ENV === 'production') {
    process.stderr.write('운영 환경에서는 개발 시드를 실행할 수 없습니다.\n')
    process.exitCode = 1
  } else if (!process.env.DATABASE_URL) {
    process.stderr.write('DATABASE_URL이 없습니다.\n')
    process.exitCode = 1
  } else {
    const client = createPool(process.env.DATABASE_URL)
    try {
      await seedCatalog(drizzle(client))
    } finally {
      await client.end()
    }
  }
}
