import { randomUUID } from 'node:crypto'
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module.js'
import { activityLog, fileObject, tag, task, taskInput, taskTag } from '../db/schema.js'
import { CONFIG, type AppConfig } from '../config/config.js'
import { FileStorageService, createStorageKey, sha256 } from './fileStorage.service.js'

export const FILE_STORAGE = Symbol('FILE_STORAGE')
type FileRow = typeof fileObject.$inferSelect
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
const id = () => randomUUID()

function validName(name: string): string {
  if (!name || !name.trim() || name.length > 255 || /[/\\]/.test(name) || [...name].some((char) => char.charCodeAt(0) < 32) || name === '.' || name === '..') throw new BadRequestException('파일 이름이 올바르지 않습니다')
  return name
}

export function fileMeta(row: FileRow) {
  return { id: row.id, originTaskId: row.originTaskId ?? undefined, name: row.originalName,
    mime: row.mime, size: row.sizeBytes, sha256: row.sha256, uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt.toISOString(), source: row.source, isOutput: row.isOutput,
    version: row.version, previousId: row.previousId ?? undefined }
}

@Injectable()
export class DbFilesService {
  constructor(@Inject(DB) private readonly db: Db, @Inject(FILE_STORAGE) private readonly storage: FileStorageService,
    @Inject(CONFIG) private readonly config: Pick<AppConfig, 'fileMaxBytes' | 'fileMaxPerRequest'>) {}

  private async row(fileId: string, tx: Db | Tx = this.db) {
    const [row] = await tx.select().from(fileObject).where(and(eq(fileObject.id, fileId), isNull(fileObject.deletedAt)))
    if (!row) throw new NotFoundException('파일을 찾을 수 없습니다')
    return row
  }

  private async editable(taskId: string, tx: Tx) {
    const [owner] = await tx.select().from(task).where(eq(task.id, taskId)).for('update')
    if (!owner) throw new NotFoundException('대화를 찾을 수 없습니다')
    if (owner.status === 'done') throw new ConflictException('완료된 대화는 재개한 뒤 수정하세요')
    return owner
  }

  private async lockChain(tx: Tx, taskId: string, name: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${taskId}), hashtext(${name}))`)
  }

  async get(fileId: string) { return fileMeta(await this.row(fileId)) }
  async content(fileId: string) { return this.storage.read((await this.row(fileId)).storageKey) }
  async contentStream(fileId: string) { return this.storage.createReadStream((await this.row(fileId)).storageKey) }

  private async create(actor: string, taskId: string, name: string, mime: string, bytes: Uint8Array, source: 'upload' | 'assistant', isOutput: boolean) {
    validName(name)
    if (bytes.byteLength > this.config.fileMaxBytes) throw new PayloadTooLargeException('파일 크기 한도를 초과했습니다')
    const storageKey = createStorageKey(name)
    await this.storage.write(storageKey, bytes)
    try {
      const row = await this.db.transaction(async (tx) => {
        await this.editable(taskId, tx)
        await this.lockChain(tx, taskId, name)
        const [prev] = await tx.select().from(fileObject).where(and(eq(fileObject.originTaskId, taskId), eq(fileObject.originalName, name), isNull(fileObject.deletedAt))).orderBy(desc(fileObject.version)).limit(1)
        if (isOutput && prev?.isOutput) await tx.update(fileObject).set({ isOutput: false }).where(eq(fileObject.id, prev.id))
        const [inserted] = await tx.insert(fileObject).values({ id: id(), kind: 'task_file', originTaskId: taskId,
          originalName: name, mime: mime || 'application/octet-stream', sizeBytes: bytes.byteLength, sha256: sha256(bytes),
          storageKey, source, isOutput, version: (prev?.version ?? 0) + 1, previousId: prev?.id, uploadedBy: actor }).returning()
        await tx.update(task).set({ lastActivityAt: new Date() }).where(eq(task.id, taskId))
        await tx.insert(activityLog).values({ id: id(), taskId, userId: actor, type: isOutput ? 'file.tagged_output' : 'file.uploaded', payload: { name, version: inserted!.version } })
        return inserted!
      })
      return fileMeta(row)
    } catch (error) {
      await this.storage.remove(storageKey)
      throw error
    }
  }

  upload(actor: string, taskId: string, name: string, mime: string, bytes: Uint8Array, isOutput = false) {
    return this.create(actor, taskId, name, mime, bytes, 'upload', isOutput)
  }
  saveOutput(actor: string, taskId: string, name: string, content: string) {
    return this.create(actor, taskId, name, 'text/markdown', Buffer.from(content), 'assistant', true)
  }

  async versions(fileId: string) {
    const start = await this.row(fileId)
    const siblings = await this.db.select().from(fileObject).where(and(eq(fileObject.originTaskId, start.originTaskId!), eq(fileObject.originalName, start.originalName)))
    const byId = new Map(siblings.map((row) => [row.id, row]))
    const descendants = siblings.filter((row) => !row.deletedAt && (row.id === start.id || this.isAncestor(start.id, row, byId)))
    const head = descendants.sort((a, b) => b.version - a.version)[0]!
    const result: ReturnType<typeof fileMeta>[] = []
    let current: FileRow | undefined = head
    while (current) { if (!current.deletedAt) result.push(fileMeta(current)); current = current.previousId ? byId.get(current.previousId) : undefined }
    return result
  }

  private isAncestor(ancestor: string, row: FileRow, byId: Map<string, FileRow>) {
    const seen = new Set<string>()
    let current = row
    while (current.previousId && !seen.has(current.id)) {
      seen.add(current.id)
      if (current.previousId === ancestor) return true
      const prev = byId.get(current.previousId)
      if (!prev) break
      current = prev
    }
    return false
  }

  async setOutput(actor: string, fileId: string, isOutput: boolean) {
    await this.db.transaction(async (tx) => {
      const row = await this.row(fileId, tx)
      if (row.kind !== 'task_file' || !row.originTaskId) throw new BadRequestException('대화 파일만 산출물로 지정할 수 있습니다')
      await this.editable(row.originTaskId, tx)
      await tx.update(fileObject).set({ isOutput }).where(eq(fileObject.id, fileId))
      await tx.insert(activityLog).values({ id: id(), taskId: row.originTaskId, userId: actor, type: 'file.tagged_output', payload: { name: row.originalName, isOutput } })
    })
  }

  async remove(fileId: string) {
    await this.db.transaction(async (tx) => {
      const row = await this.row(fileId, tx)
      if (row.kind !== 'task_file' || !row.originTaskId) throw new BadRequestException('대화 파일만 삭제할 수 있습니다')
      await this.editable(row.originTaskId, tx)
      await this.lockChain(tx, row.originTaskId, row.originalName)
      await this.row(fileId, tx)
      const chain = await tx.select().from(fileObject).where(and(eq(fileObject.originTaskId, row.originTaskId!), eq(fileObject.originalName, row.originalName)))
      const byId = new Map(chain.map((item) => [item.id, item]))
      const root = (item: FileRow) => { let current = item; const seen = new Set<string>(); while (current.previousId && byId.has(current.previousId) && !seen.has(current.id)) { seen.add(current.id); current = byId.get(current.previousId)! } return current.id }
      const chainIds = chain.filter((item) => root(item) === root(row)).map((item) => item.id)
      const selected = chainIds.length ? await tx.select({ taskId: taskInput.taskId }).from(taskInput).where(inArray(taskInput.fileId, chainIds)) : []
      if (selected.some((item) => item.taskId !== row.originTaskId)) throw new ConflictException('다른 대화에서 입력으로 사용 중인 파일은 삭제할 수 없습니다')
      await tx.delete(taskInput).where(eq(taskInput.fileId, fileId))
      await tx.update(fileObject).set({ deletedAt: new Date(), isOutput: false }).where(eq(fileObject.id, fileId))
    })
  }

  private async candidateRows(taskId: string, tx: Db | Tx = this.db) {
    const [me] = await tx.select().from(task).where(eq(task.id, taskId))
    if (!me) throw new NotFoundException('대화를 찾을 수 없습니다')
    const myTags = await tx.select({ key: taskTag.tagKey }).from(taskTag).where(eq(taskTag.taskId, taskId))
    const matching = myTags.length ? await tx.select({ taskId: taskTag.taskId, key: taskTag.tagKey, label: tag.label }).from(taskTag).innerJoin(tag, eq(taskTag.tagKey, tag.key)).where(inArray(taskTag.tagKey, myTags.map((item) => item.key))) : []
    const via = new Map<string, string[]>()
    for (const item of matching) if (item.taskId !== taskId) via.set(item.taskId, [...(via.get(item.taskId) ?? []), item.label])
    const sourceIds = [taskId, ...via.keys()]
    const sourceRows = await tx.select().from(fileObject).where(inArray(fileObject.originTaskId, sourceIds))
    const rows = sourceRows.filter((row) => !row.deletedAt)
    const selected = await tx.select().from(taskInput).where(eq(taskInput.taskId, taskId))
    const detachedIds = selected.map((item) => item.fileId).filter((fileId) => !rows.some((row) => row.id === fileId))
    const detached = detachedIds.length ? await tx.select().from(fileObject).where(and(inArray(fileObject.id, detachedIds), isNull(fileObject.deletedAt))) : []
    const extraOrigins = [...new Set(detached.map((row) => row.originTaskId).filter((value): value is string => !!value && !sourceIds.includes(value)))]
    const extraRows = extraOrigins.length ? await tx.select().from(fileObject).where(inArray(fileObject.originTaskId, extraOrigins)) : []
    return { rows: [...rows, ...detached], chainRows: [...sourceRows, ...extraRows], selected, via }
  }

  async candidates(taskId: string) {
    const { rows, chainRows, selected, via } = await this.candidateRows(taskId)
    const selectedById = new Map(selected.map((item) => [item.fileId, item.weight]))
    const byId = new Map(chainRows.map((row) => [row.id, row]))
    const rootOf = (row: FileRow) => { let current = row; const seen = new Set<string>(); while (current.previousId && byId.has(current.previousId) && !seen.has(current.id)) { seen.add(current.id); current = byId.get(current.previousId)! } return current.id }
    const heads = new Map<string, FileRow>()
    for (const row of chainRows) if (!row.deletedAt) {
      const root = rootOf(row)
      if ((heads.get(root)?.version ?? 0) < row.version) heads.set(root, row)
    }
    const files = rows.filter((row) => row.kind === 'task_file' && (heads.get(rootOf(row))?.id === row.id || selectedById.has(row.id))).map((row) => {
      const head = heads.get(rootOf(row))!.id
      const olderVersionIds: string[] = []
      if (head === row.id) { let previous = row.previousId; while (previous && byId.has(previous)) { if (!byId.get(previous)!.deletedAt) olderVersionIds.push(previous); previous = byId.get(previous)!.previousId } }
      return { file: fileMeta(row), sourceTaskId: row.originTaskId, viaTags: via.get(row.originTaskId!) ?? [], role: row.isOutput || row.source === 'assistant' ? 'output' : 'upload',
        ...(selectedById.has(row.id) && { selected: selectedById.get(row.id) }),
        ...(head !== row.id && { newerVersionId: head }), ...(olderVersionIds.length && { olderVersionIds }) }
    })
    return { files, conversations: [] }
  }

  async filesForTask(taskId: string) {
    const rows = await this.db.select({ taskId: task.id, file: fileObject }).from(task)
      .leftJoin(fileObject, and(eq(fileObject.originTaskId, task.id), isNull(fileObject.deletedAt)))
      .where(eq(task.id, taskId))
    if (!rows.length) throw new NotFoundException('대화를 찾을 수 없습니다')
    return rows.flatMap((row) => row.file ? [fileMeta(row.file)] : [])
  }

  async setInput(actor: string, taskId: string, fileId: string, weight: 'main' | 'reference' | null) {
    await this.db.transaction(async (tx) => {
      await this.editable(taskId, tx)
      const row = await this.row(fileId, tx)
      if (row.kind !== 'task_file') throw new BadRequestException('선택할 수 없는 파일입니다')
      await tx.select({ id: task.id }).from(task).where(eq(task.id, row.originTaskId!)).for('share')
      await this.lockChain(tx, row.originTaskId!, row.originalName)
      await this.row(fileId, tx)
      if (weight) {
        const { rows } = await this.candidateRows(taskId, tx)
        if (!rows.some((item) => item.id === fileId)) throw new BadRequestException('후보에 없는 파일입니다')
        const [max] = await tx.select({ sortOrder: taskInput.sortOrder }).from(taskInput).where(eq(taskInput.taskId, taskId)).orderBy(desc(taskInput.sortOrder)).limit(1)
        await tx.insert(taskInput).values({ taskId, fileId, weight, sortOrder: (max?.sortOrder ?? -1) + 1, selectedBy: actor }).onConflictDoUpdate({ target: [taskInput.taskId, taskInput.fileId], set: { weight, selectedBy: actor, selectedAt: new Date() } })
      } else await tx.delete(taskInput).where(and(eq(taskInput.taskId, taskId), eq(taskInput.fileId, fileId)))
      await tx.insert(activityLog).values({ id: id(), taskId, userId: actor, type: weight ? 'input.selected' : 'input.removed', payload: { name: row.originalName, version: row.version, weight } })
    })
  }

  async switchInputVersion(actor: string, taskId: string, fromFileId: string, toFileId: string) {
    await this.db.transaction(async (tx) => {
      await this.editable(taskId, tx)
      const from = await this.row(fromFileId, tx)
      const to = await this.row(toFileId, tx)
      if (from.kind !== 'task_file' || !from.originTaskId || to.kind !== 'task_file') throw new BadRequestException('대화 파일만 선택할 수 있습니다')
      await this.lockChain(tx, from.originTaskId!, from.originalName)
      await this.row(fromFileId, tx)
      await this.row(toFileId, tx)
      const selected = await tx.select().from(taskInput).where(and(eq(taskInput.taskId, taskId), eq(taskInput.fileId, fromFileId)))
      if (!selected.length) throw new BadRequestException('선택된 버전이 아닙니다')
      if (from.originTaskId !== to.originTaskId || from.originalName !== to.originalName) throw new BadRequestException('같은 버전 체인만 선택할 수 있습니다')
      const chain = await tx.select().from(fileObject).where(and(eq(fileObject.originTaskId, from.originTaskId!), eq(fileObject.originalName, from.originalName)))
      const byId = new Map(chain.map((item) => [item.id, item]))
      const root = (item: FileRow) => { let current = item; const seen = new Set<string>(); while (current.previousId && byId.has(current.previousId) && !seen.has(current.id)) { seen.add(current.id); current = byId.get(current.previousId)! } return current.id }
      if (root(from) !== root(to)) throw new BadRequestException('같은 버전 체인만 선택할 수 있습니다')
      const [target] = await tx.select().from(taskInput).where(and(eq(taskInput.taskId, taskId), eq(taskInput.fileId, toFileId)))
      await tx.delete(taskInput).where(and(eq(taskInput.taskId, taskId), eq(taskInput.fileId, fromFileId)))
      const weight = selected[0]!.weight === 'main' || target?.weight === 'main' ? 'main' : 'reference'
      if (target) await tx.update(taskInput).set({ weight, selectedBy: actor, selectedAt: new Date() }).where(and(eq(taskInput.taskId, taskId), eq(taskInput.fileId, toFileId)))
      else await tx.insert(taskInput).values({ ...selected[0]!, fileId: toFileId, selectedBy: actor, selectedAt: new Date() })
      await tx.insert(activityLog).values({ id: id(), taskId, userId: actor, type: 'input.selected', payload: { name: to.originalName, version: to.version, weight } })
    })
  }
}
