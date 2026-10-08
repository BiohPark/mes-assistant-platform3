import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { and, eq, isNull, ne, notInArray, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import type { Db } from './db.module.js'
import { createPool } from './connection.js'
import { lockAssistantCodes, writeClassifications } from './classifications.js'
import { isDuplicateKey } from './errors.js'
import { appSetting, appUser, assistant, assistantChecklistTemplate, assistantExpectedIo, code, codeGroup } from './schema.js'
import { SEED_ASSISTANTS, SR_INTAKE_ASSISTANT_ID } from './seedData.js'
import { hashPassword } from '../auth/password.js'
import { initialsOf, pickColor } from '../auth/userDisplay.js'

export function assertDevelopmentSeed(environment = process.env.NODE_ENV) {
  if (environment === 'production') throw new Error('운영 환경에서는 개발 시드를 실행할 수 없습니다.')
}

async function insertUnlessDuplicate(insert: () => Promise<unknown>): Promise<boolean> {
  try { await insert(); return true } catch (error) {
    if (isDuplicateKey(error)) return false
    throw error
  }
}

/** 개발·E2E 카탈로그만 추가한다. 기존 항목은 수정하지 않는다. */
export async function seedCatalog(db: Db, { devUserPassword }: { devUserPassword?: string } = {}): Promise<void> {
  assertDevelopmentSeed()
  const passwordHash = devUserPassword ? await hashPassword(devUserPassword) : null
  await db.transaction(async (tx) => {
    await lockAssistantCodes(tx as Db)
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
      await writeClassifications(tx as Db, item.id, item.classifications!.map(({ level1CodeId, level2CodeId }) => ({ level1CodeId, level2CodeId })))
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
    const [intake] = await tx.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'srIntakeAssistantId')).for('update')
    if (!intake) await insertUnlessDuplicate(() => tx.insert(appSetting).values({ key: 'srIntakeAssistantId', value: SR_INTAKE_ASSISTANT_ID }))
    else if (!intake.value) await tx.update(appSetting).set({ value: SR_INTAKE_ASSISTANT_ID }).where(eq(appSetting.key, 'srIntakeAssistantId'))
    const devUsers = [
      { loginId: 'dev-owner', name: '개발 관리자', isSystemOwner: true, isBusinessOwner: false },
      { loginId: 'dev-member', name: '개발 담당자', isSystemOwner: false, isBusinessOwner: false },
      { loginId: 'dev-requester', name: '개발 요청자', isSystemOwner: false, isBusinessOwner: true },
    ]
    if (process.env.SEED_DEV_ACCOUNTS !== 'true') console.log('개발 계정 시드 건너뜀: SEED_DEV_ACCOUNTS가 true가 아닙니다.')
    else if (!passwordHash) console.log('개발 계정 시드 건너뜀: DEV_USER_PASSWORD가 없습니다.')
    else {
      const [realUser] = await tx.select({ id: appUser.id }).from(appUser).where(and(
        ne(appUser.id, 'seed-system'),
        or(isNull(appUser.loginId), notInArray(appUser.loginId, devUsers.map((user) => user.loginId))),
      )).limit(1)
      if (realUser) console.log('개발 계정 시드 건너뜀: DB에 실제 사용자가 있습니다.')
      else for (const user of devUsers) {
        const [existing] = await tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.loginId, user.loginId))
        if (existing) continue
        const id = randomUUID()
        await insertUnlessDuplicate(() => tx.insert(appUser).values({ id, ...user, passwordHash, initials: initialsOf(user.name), color: pickColor(id) }))
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
      await seedCatalog(drizzle(client), { devUserPassword: process.env.DEV_USER_PASSWORD })
    } finally {
      await client.end()
    }
  }
}
