import { randomBytes, randomUUID } from 'node:crypto'
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, asc, eq, or, sql } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module.js'
import { activityLog, appSetting, appUser, assistant, assistantChecklistTemplate, assistantClassification, assistantExpectedIo, checklistItem, code, codeGroup, fileObject, task } from '../db/schema.js'
import { lockAssistantCodes, resolveCode, resolveClassifications, writeClassifications, type ClassificationIds } from '../db/classifications.js'
import type { ClassificationInput } from '@mes/contracts'
import { isDuplicateKey } from '../db/errors.js'
import { CONFIG, type AppConfig } from '../config/config.js'
import { FILE_STORAGE } from '../files/files.service.js'
import { FileStorageService, createStorageKey, sha256 } from '../files/fileStorage.service.js'
import { Optional, PayloadTooLargeException } from '@nestjs/common'

type AssistantInput = {
  classifications?: ClassificationInput[]; id?: string; name: string; level1?: string; level2?: string; level1CodeId?: string; level2CodeId?: string; summary: string; ownerId: string
  status: 'open' | 'developing' | 'testing' | 'retired'; usageExample: string; modelId?: string | null
  link1?: string | null; docUrl?: string | null; expectedInputs: string[]; expectedOutputs: string[]
  checklistTemplate: { id: string; label: string; required: boolean }[]
}
type AssistantPatch = Partial<Omit<AssistantInput, 'id'>>
/** 기본 모델은 .env 정본(effectiveDefaultModel) — 쓰기 DTO에 없다 (S7 C2) */
type SettingsPatch = Partial<{ fileDelivery: 'inline' | 'openwebui'; requestBudgetBytes: number; srIntakeAssistantId: string | null; link1Rule: string; fileMaxPerRequest: number }>
const normalizeCodeName = (value: string) => value.trim().replace(/\s+/gu, ' ').normalize('NFC')
const defaultChecklist = () => [
  { id: randomUUID(), label: '입력 자료 선택', required: true },
  { id: randomUUID(), label: '결과 검토', required: true },
  { id: randomUUID(), label: '산출물 저장', required: false },
]

@Injectable()
export class AdminService {
  constructor(@Inject(DB) private readonly db: Db,
    @Optional() @Inject(FILE_STORAGE) private readonly storage?: FileStorageService,
    @Optional() @Inject(CONFIG) private readonly config?: AppConfig) {}

  private async lockCodes(tx: Db) {
    await lockAssistantCodes(tx)
  }
  private async legacyPath(tx: Db, input: AssistantPatch, current?: ClassificationIds): Promise<ClassificationIds> {
    const level1CodeId = input.level1CodeId ?? (input.level1 !== undefined ? await resolveCode(tx, 'assistant_level1', input.level1) : current?.level1CodeId)
    const level2CodeId = input.level2CodeId ?? (input.level2 !== undefined ? await resolveCode(tx, 'assistant_level2', input.level2) : current?.level2CodeId)
    if (!level1CodeId || !level2CodeId) throw new BadRequestException('분류 이름 또는 코드를 입력하세요')
    return { level1CodeId, level2CodeId }
  }
  private async cleanupCodes(tx: Db, ids: string[]) {
    for (const id of [...new Set(ids)].sort()) {
      const [row] = await tx.select().from(code).where(eq(code.id, id)).for('update')
      if (!row?.isAuto) continue
      // 참조 변경은 assistant-codes 잠금으로 직렬화한다. 순서 저장과 assistant 행 잠금을 교차하지 않는다.
      const [linked] = await tx.select({ id: assistantClassification.assistantId }).from(assistantClassification)
        .where(or(eq(assistantClassification.level1CodeId, id), eq(assistantClassification.level2CodeId, id))).limit(1)
      if (!linked) await tx.delete(code).where(and(eq(code.id, id), eq(code.isAuto, true)))
    }
  }
  private async ownerValid(tx: Db, id: string) {
    const [row] = await tx.select({ id: appUser.id }).from(appUser).where(and(eq(appUser.id, id), eq(appUser.active, true))).for('update')
    if (!row) throw new BadRequestException('활성 사용자를 담당자로 선택하세요')
  }
  async assistant(id: string) {
    const [row] = await this.db.select().from(assistant).where(eq(assistant.id, id))
    if (!row) throw new NotFoundException('에이전트를 찾을 수 없습니다')
    return row
  }
  private async isIntake(id: string, tx: Db = this.db) {
    const [row] = await tx.select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'srIntakeAssistantId'))
    return row?.value === id
  }
  async createAssistant(actor: string, input: AssistantInput) {
    if (input.status === 'retired') throw new BadRequestException('새 에이전트는 폐기 상태로 만들 수 없습니다')
    try {
      const id = await this.db.transaction(async (tx) => {
        await this.lockCodes(tx as Db)
        const paths = await resolveClassifications(tx as Db, input.classifications ?? [await this.legacyPath(tx as Db, input)])
        const refs = paths[0]!
        await this.ownerValid(tx as Db, input.ownerId)
        await tx.execute(sql`insert into db_lock (lock_key) values ('assistant-order') on duplicate key update lock_key = lock_key`)
        let id = input.id
        if (id === undefined) {
          do { id = `a-${randomBytes(6).toString('hex')}` }
          while ((await tx.select({ id: assistant.id }).from(assistant).where(eq(assistant.id, id))).length)
        }
        const [last] = await tx.select({ order: assistant.sortOrder }).from(assistant).orderBy(sql`${assistant.sortOrder} desc`).limit(1)
        await tx.insert(assistant).values({ id, name: input.name, level1CodeId: refs.level1CodeId,
          level2CodeId: refs.level2CodeId, summary: input.summary, sortOrder: (last?.order ?? 0) + 1,
          modelId: input.modelId, link1: input.link1, docUrl: input.docUrl, ownerId: input.ownerId,
          status: input.status, usageExample: input.usageExample, color: '#2563eb', createdBy: actor })
        await writeClassifications(tx as Db, id, paths)
        await this.replaceNested(tx, id, input)
        return id
      })
      return this.assistant(id)
    } catch (error) {
      if (isDuplicateKey(error)) throw new ConflictException('이미 존재하는 에이전트 ID입니다')
      throw error
    }
  }
  private async replaceNested(tx: Parameters<Parameters<Db['transaction']>[0]>[0], id: string, input: AssistantPatch) {
    if (input.expectedInputs !== undefined || input.expectedOutputs !== undefined) {
      for (const [direction, values] of [['input', input.expectedInputs], ['output', input.expectedOutputs]] as const) {
        if (values === undefined) continue
        await tx.delete(assistantExpectedIo).where(and(eq(assistantExpectedIo.assistantId, id), eq(assistantExpectedIo.direction, direction)))
        for (const [sortOrder, label] of values.entries()) await tx.insert(assistantExpectedIo).values({ assistantId: id, direction, sortOrder, label })
      }
    }
    if (input.checklistTemplate) {
      if (new Set(input.checklistTemplate.map((item) => item.id)).size !== input.checklistTemplate.length) throw new BadRequestException('체크리스트 ID가 중복되었습니다')
      const existing = await tx.select().from(assistantChecklistTemplate).where(eq(assistantChecklistTemplate.assistantId, id))
      for (const old of existing.filter((row) => !input.checklistTemplate!.some((item) => item.id === row.id))) {
        await tx.update(checklistItem).set({ templateItemId: null }).where(eq(checklistItem.templateItemId, old.id))
        await tx.delete(assistantChecklistTemplate).where(eq(assistantChecklistTemplate.id, old.id))
      }
      for (const [sortOrder, item] of input.checklistTemplate.entries()) {
        if (existing.some((row) => row.id === item.id)) await tx.update(assistantChecklistTemplate).set({ sortOrder, label: item.label, required: item.required }).where(eq(assistantChecklistTemplate.id, item.id))
        else await tx.insert(assistantChecklistTemplate).values({ id: item.id, assistantId: id, sortOrder, label: item.label, required: item.required })
      }
    }
  }
  async updateAssistant(id: string, patch: AssistantPatch) {
    await this.db.transaction(async (tx) => {
      await this.lockCodes(tx as Db)
      const [current] = await tx.select().from(assistant).where(eq(assistant.id, id)).for('update')
      if (!current) throw new NotFoundException('에이전트를 찾을 수 없습니다')
      const oldPaths = await tx.select().from(assistantClassification).where(eq(assistantClassification.assistantId, id)).orderBy(asc(assistantClassification.sortOrder))
      const hasLegacyPath = ['level1', 'level2', 'level1CodeId', 'level2CodeId'].some(key => key in patch)
      if (patch.classifications && hasLegacyPath) throw new BadRequestException('분류 경로와 대표 필드를 함께 수정할 수 없습니다')
      let paths = patch.classifications
      if (hasLegacyPath) {
        const representative = await this.legacyPath(tx as Db, patch, current)
        paths = [representative, ...oldPaths.slice(1)
          .filter(path => path.level1CodeId !== representative.level1CodeId || path.level2CodeId !== representative.level2CodeId)
          .map(({ level1CodeId, level2CodeId }) => ({ level1CodeId, level2CodeId }))]
      }
      if (paths !== undefined) await writeClassifications(tx as Db, id, paths, hasLegacyPath ? current : undefined)
      if (patch.ownerId && patch.ownerId !== current.ownerId) await this.ownerValid(tx as Db, patch.ownerId)
      if (patch.status === 'retired' && await this.isIntake(id, tx as Db)) throw new ConflictException('접수 에이전트는 중단할 수 없습니다')
      const { expectedInputs, expectedOutputs, checklistTemplate, classifications, level1, level2, level1CodeId, level2CodeId, ...fields } = patch
      void expectedInputs; void expectedOutputs; void checklistTemplate; void level1; void level2; void classifications; void level1CodeId; void level2CodeId
      await tx.update(assistant).set({ ...fields, revision: current.revision + 1, updatedAt: new Date() }).where(eq(assistant.id, id))
      await this.replaceNested(tx, id, patch)
      await this.cleanupCodes(tx as Db, oldPaths.flatMap(path => [path.level1CodeId, path.level2CodeId]))
    })
    return this.assistant(id)
  }
  async deleteAssistant(id: string) {
    await this.db.transaction(async (tx) => {
      await this.lockCodes(tx as Db)
      const [row] = await tx.select().from(assistant).where(eq(assistant.id, id)).for('update')
      if (!row) throw new NotFoundException('에이전트를 찾을 수 없습니다')
      if (await this.isIntake(id, tx as Db)) throw new ConflictException('접수 에이전트는 삭제할 수 없습니다')
      const [linked] = await tx.select({ id: task.id }).from(task).where(eq(task.assistantId, id)).limit(1)
      if (linked) throw new ConflictException('대화가 연결되어 있어 삭제할 수 없습니다')
      const [recorded] = await tx.select({ id: activityLog.id }).from(activityLog).where(eq(activityLog.assistantId, id)).limit(1)
      if (recorded) throw new ConflictException('활동 이력이 있어 삭제할 수 없습니다')
      const oldPaths = await tx.select().from(assistantClassification).where(eq(assistantClassification.assistantId, id))
      await tx.delete(assistant).where(eq(assistant.id, id))
      await this.cleanupCodes(tx as Db, oldPaths.flatMap(path => [path.level1CodeId, path.level2CodeId]))
      if (row.imageFileId) await tx.update(fileObject).set({ deletedAt: new Date() }).where(eq(fileObject.id, row.imageFileId))
    })
  }
  async image(actor: string, id: string, file: { originalname: string; mimetype: string; buffer: Buffer; size: number } | null) {
    if (file && (!/^image\/(png|jpeg|webp|gif)$/.test(file.mimetype) || file.originalname.length > 255)) throw new BadRequestException('지원하지 않는 이미지입니다')
    if (file && file.size > (this.config?.fileMaxBytes ?? 20_000_000)) throw new PayloadTooLargeException('이미지 크기 한도를 초과했습니다')
    if (file && !this.storage) throw new Error('파일 저장소가 없습니다')
    const storageKey = file ? createStorageKey(file.originalname) : null
    if (file && storageKey) await this.storage!.write(storageKey, file.buffer)
    try {
      await this.db.transaction(async (tx) => {
        const [row] = await tx.select().from(assistant).where(eq(assistant.id, id)).for('update')
        if (!row) throw new NotFoundException('에이전트를 찾을 수 없습니다')
        const fileId = file ? randomUUID() : null
        if (file && storageKey && fileId) await tx.insert(fileObject).values({ id: fileId, kind: 'assistant_image',
          originalName: file.originalname, mime: file.mimetype, sizeBytes: file.size, sha256: sha256(file.buffer),
          storageKey, source: 'upload', version: 1, uploadedBy: actor })
        await tx.update(assistant).set({ imageFileId: fileId, revision: row.revision + 1, updatedAt: new Date() }).where(eq(assistant.id, id))
        if (row.imageFileId) await tx.update(fileObject).set({ deletedAt: new Date() }).where(eq(fileObject.id, row.imageFileId))
      })
    } catch (error) {
      if (storageKey) await this.storage!.remove(storageKey)
      throw error
    }
    return this.assistant(id)
  }
  async order(ids: string[], revisions: Record<string, number>) {
    if (new Set(ids).size !== ids.length) throw new BadRequestException('중복된 에이전트 ID입니다')
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`insert into db_lock (lock_key) values ('assistant-order') on duplicate key update lock_key = lock_key`)
      const rows = await tx.select().from(assistant).orderBy(asc(assistant.id)).for('update')
      if (ids.length !== rows.length || rows.some((row) => !ids.includes(row.id))) throw new ConflictException('에이전트 목록이 변경되었습니다. 다시 조회하세요')
      if (rows.some((row) => revisions[row.id] !== row.revision)) throw new ConflictException('에이전트 순서가 변경되었습니다. 다시 조회하세요')
      for (const [index, id] of ids.entries()) await tx.update(assistant).set({ sortOrder: index + 1, revision: sql`${assistant.revision} + 1`, updatedAt: new Date() }).where(eq(assistant.id, id))
    })
  }
  async getSettings() {
    const rows = await this.db.select().from(appSetting)
    // 구형 defaultModel 행은 지우지 않고 숨긴다 — 읽기 DTO의 defaultModel은 컨트롤러가 .env 유효값으로 채운다 (S7 C2)
    return Object.fromEntries(rows.filter((row) => row.key !== 'defaultModel').map((row) => [row.key, row.value])) as Record<string, unknown>
  }
  async settings(patch: SettingsPatch) {
    await this.db.transaction(async (tx) => {
      if (patch.srIntakeAssistantId) {
        const [row] = await tx.select({ status: assistant.status }).from(assistant).where(eq(assistant.id, patch.srIntakeAssistantId)).for('update')
        if (!row) throw new BadRequestException('접수 에이전트를 찾을 수 없습니다')
        if (row.status === 'retired') throw new ConflictException('폐기된 에이전트는 접수 에이전트로 지정할 수 없습니다')
      }
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'srIntakeAssistantId' && value === null) await tx.delete(appSetting).where(eq(appSetting.key, key))
        else await tx.insert(appSetting).values({ key, value }).onDuplicateKeyUpdate({ set: { value } })
      }
    })
    return this.getSettings()
  }
  async codes(group?: string, includeInactive = false) {
    return this.db.select().from(code).where(and(group ? eq(code.groupKey, group) : undefined, includeInactive ? undefined : eq(code.active, true))).orderBy(asc(code.sortOrder), asc(code.id))
  }
  private async uniqueCodeName(tx: Db, group: string, name: string, id?: string) {
    const rows = await tx.select().from(code).where(eq(code.groupKey, group)).orderBy(asc(code.id)).for('update')
    const key = normalizeCodeName(name).toLowerCase()
    if (rows.some(row => row.id !== id && normalizeCodeName(row.name).toLowerCase() === key)) throw new ConflictException('이미 존재하는 분류 이름입니다')
  }
  async createCode(input: { groupKey: string; code: string; name: string; sortOrder?: number }) {
    const id = `${input.groupKey}:${input.code}`
    if (id.length > 191) throw new BadRequestException('코드 ID는 191자를 넘을 수 없습니다')
    try {
      return await this.db.transaction(async tx => {
        await this.lockCodes(tx as Db)
        const [group] = await tx.select().from(codeGroup).where(eq(codeGroup.key, input.groupKey))
        if (!group) throw new BadRequestException('정의되지 않은 코드 그룹입니다')
        await this.uniqueCodeName(tx as Db, input.groupKey, input.name)
        await tx.insert(code).values({ id, ...input, sortOrder: input.sortOrder ?? 0 })
        return (await tx.select().from(code).where(eq(code.id, id)))[0]
      })
    }
    catch (error) { if (isDuplicateKey(error)) throw new ConflictException('이미 존재하는 코드입니다'); throw error }
  }
  async updateCode(id: string, patch: { name?: string; sortOrder?: number; active?: boolean }) {
    return this.db.transaction(async tx => {
      await this.lockCodes(tx as Db)
      const [row] = await tx.select().from(code).where(eq(code.id, id)).for('update')
      if (!row) throw new NotFoundException('코드를 찾을 수 없습니다')
      if (patch.name !== undefined) await this.uniqueCodeName(tx as Db, row.groupKey, patch.name, id)
      await tx.update(code).set(patch).where(eq(code.id, id))
      return (await tx.select().from(code).where(eq(code.id, id)))[0]
    })
  }
}

export { defaultChecklist }
