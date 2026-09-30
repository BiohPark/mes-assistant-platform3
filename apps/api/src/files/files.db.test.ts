import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/mysql2'
import type { Pool } from 'mysql2/promise'
import { createPool } from '../db/connection.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appUser, assistant, taskInput } from '../db/schema.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { createTempDb } from '../test/tempDb.js'
import { DbTasksService } from '../tasks/tasks.service.js'
import { FileStorageService } from './fileStorage.service.js'
import { DbFilesService } from './files.service.js'

describe('files DB', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let client: Pool
  let root: string
  let files: DbFilesService
  let tasks: DbTasksService
  let assistantId: string
  beforeAll(async () => {
    temp = await createTempDb('files')
    await runMigrations(temp.url)
    client = createPool(temp.url)
    const db = drizzle(client)
    await seedCatalog(db)
    await db.insert(appUser).values({ id: 'member', name: 'Member', initials: 'M', color: '#123456' })
    assistantId = (await db.select().from(assistant))[0]!.id
    root = await mkdtemp(join(tmpdir(), 'mes-files-'))
    files = new DbFilesService(db, new FileStorageService(root), { fileMaxBytes: 1024, fileMaxPerRequest: 2 } as never)
    tasks = new DbTasksService(db)
  })
  afterAll(async () => { await client?.end(); await temp?.drop(); if (root) await rm(root, { recursive: true, force: true }) })

  it('uploads separate chains per task, preserves bytes, and leaves selected versions pinned', async () => {
    const a = (await tasks.create('member', { assistantId, tags: ['shared'] })).task
    const b = (await tasks.create('member', { assistantId, tags: ['shared'] })).task
    const first = await files.upload('member', a.id, 'report.txt', 'text/plain', Buffer.from('one'))
    await files.setInput('member', b.id, first.id, 'main')
    const second = await files.upload('member', a.id, 'report.txt', 'text/plain', Buffer.from('two'))
    const other = await files.upload('member', b.id, 'report.txt', 'text/plain', Buffer.from('other'))
    expect([first.version, second.version, second.previousId, other.version]).toEqual([1, 2, first.id, 1])
    expect(Buffer.from(await files.content(second.id)).toString()).toBe('two')
    expect((await files.versions(second.id)).map((f) => f.id)).toEqual([second.id, first.id])
    expect((await files.candidates(b.id)).files).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: expect.objectContaining({ id: first.id }), newerVersionId: second.id }),
      expect.objectContaining({ file: expect.objectContaining({ id: second.id }) }),
    ]))
    expect((await tasks.get(b.id)).inputs).toMatchObject([{ fileId: first.id, weight: 'main' }])
    await expect(files.remove(first.id)).rejects.toMatchObject({ status: 409 })
    await expect(files.remove(second.id)).rejects.toMatchObject({ status: 409 })
    await files.switchInputVersion('member', b.id, first.id, second.id)
    expect((await tasks.get(b.id)).inputs).toMatchObject([{ fileId: second.id, weight: 'main' }])
    await files.setInput('member', b.id, second.id, null)
    await files.remove(second.id)
    await expect(files.get(second.id)).rejects.toMatchObject({ status: 404 })
  })

  it('includes only directly shared tags and rejects noncandidate inputs', async () => {
    const a = (await tasks.create('member', { assistantId, tags: ['a'] })).task
    const b = (await tasks.create('member', { assistantId, tags: ['a', 'b'] })).task
    const c = (await tasks.create('member', { assistantId, tags: ['b'] })).task
    const direct = await files.upload('member', b.id, 'direct.txt', 'text/plain', Buffer.from('direct'))
    const indirect = await files.upload('member', c.id, 'indirect.txt', 'text/plain', Buffer.from('indirect'))
    expect((await files.candidates(a.id)).files.map((item) => item.file.id)).toContain(direct.id)
    expect((await files.candidates(a.id)).files.map((item) => item.file.id)).not.toContain(indirect.id)
    await expect(files.setInput('member', a.id, indirect.id, 'reference')).rejects.toMatchObject({ status: 400 })
    await files.setInput('member', a.id, direct.id, 'reference')
    await tasks.removeTag('member', b.id, 'a')
    expect((await files.candidates(a.id)).files.map((item) => item.file.id)).toContain(direct.id)
    const newer = await files.upload('member', b.id, 'direct.txt', 'text/plain', Buffer.from('newer'))
    expect((await files.candidates(a.id)).files.find((item) => item.file.id === direct.id)?.newerVersionId).toBe(newer.id)
    await files.switchInputVersion('member', a.id, direct.id, newer.id)
    expect((await tasks.get(a.id)).inputs).toMatchObject([{ fileId: newer.id, weight: 'reference' }])
    await expect(files.setInput('member', a.id, indirect.id, 'main')).rejects.toMatchObject({ status: 400 })
    await tasks.setStatus('member', a.id, 'done')
    await expect(files.setInput('member', a.id, direct.id, 'main')).rejects.toMatchObject({ status: 409 })
  })

  it('hides files owned by a deleted task from candidates and task files', async () => {
    const source = (await tasks.create('member', { assistantId, tags: ['visible'] })).task
    const consumer = (await tasks.create('member', { assistantId, tags: ['visible'] })).task
    const file = await files.upload('member', source.id, 'hidden.txt', 'text/plain', Buffer.from('hidden'))
    expect((await files.candidates(consumer.id)).files.map((item) => item.file.id)).toContain(file.id)
    await tasks.delete(source.id)
    expect((await files.candidates(consumer.id)).files.map((item) => item.file.id)).not.toContain(file.id)
    await expect(files.filesForTask(source.id)).rejects.toMatchObject({ status: 404 })
    await expect(files.setOutput('member', file.id, true)).rejects.toMatchObject({ status: 404 })
  })

  it('keeps outputs versioned and input order main before reference', async () => {
    const a = (await tasks.create('member', { assistantId })).task
    const first = await files.saveOutput('member', a.id, 'answer.md', '# one')
    const second = await files.saveOutput('member', a.id, 'answer.md', '# two')
    expect(second).toMatchObject({ version: 2, previousId: first.id, source: 'assistant', isOutput: true })
    expect((await tasks.get(a.id)).outputFileIds).toContain(second.id)
    expect((await tasks.get(a.id)).outputFileIds).not.toContain(first.id)
    await files.setInput('member', a.id, first.id, 'reference')
    await files.setInput('member', a.id, second.id, 'main')
    expect((await tasks.get(a.id)).inputs.map((i) => i.fileId)).toEqual([second.id, first.id])
    const db = drizzle(client)
    expect(await db.select().from(taskInput)).not.toHaveLength(0)
  })

  it('marks an upload as output in the same version write', async () => {
    const a = (await tasks.create('member', { assistantId })).task
    const uploaded = await files.upload('member', a.id, 'manual.txt', 'text/plain', Buffer.from('x'), true)
    expect(uploaded.isOutput).toBe(true)
    expect((await tasks.get(a.id)).outputFileIds).toContain(uploaded.id)
  })

  it('keeps concurrent uploads in one unbroken version chain', async () => {
    const owner = (await tasks.create('member', { assistantId })).task
    const uploaded = await Promise.all(Array.from({ length: 6 }, (_, index) => files.upload('member', owner.id, 'parallel.txt', 'text/plain', Buffer.from(String(index)))))
    expect(uploaded.map((file) => file.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
    const byId = new Map(uploaded.map((file) => [file.id, file]))
    const chain = uploaded.sort((a, b) => b.version - a.version)
    expect(chain.map((file) => file.previousId)).toEqual([...chain.slice(1).map((file) => file.id), undefined])
    expect((await files.versions(chain[0]!.id)).map((file) => file.id)).toEqual(chain.map((file) => file.id))
    expect(byId.size).toBe(6)
  })

  it('selects files across two tasks in both directions concurrently', async () => {
    const a = (await tasks.create('member', { assistantId, tags: ['cross'] })).task
    const b = (await tasks.create('member', { assistantId, tags: ['cross'] })).task
    const af = await files.upload('member', a.id, 'a.txt', 'text/plain', Buffer.from('a'))
    const bf = await files.upload('member', b.id, 'b.txt', 'text/plain', Buffer.from('b'))
    await Promise.all([files.setInput('member', a.id, bf.id, 'main'), files.setInput('member', b.id, af.id, 'main')])
    expect((await tasks.get(a.id)).inputs).toMatchObject([{ fileId: bf.id }])
    expect((await tasks.get(b.id)).inputs).toMatchObject([{ fileId: af.id }])
  })

  it('rejects a missing target version before changing the selected file', async () => {
    const owner = (await tasks.create('member', { assistantId })).task
    const file = await files.upload('member', owner.id, 'version.txt', 'text/plain', Buffer.from('one'))
    await files.setInput('member', owner.id, file.id, 'main')
    await expect(files.switchInputVersion('member', owner.id, file.id, 'missing-version')).rejects.toMatchObject({ status: 404 })
    expect((await tasks.get(owner.id)).inputs).toMatchObject([{ fileId: file.id }])
  })

  it('merges an already selected target version and retains its order', async () => {
    const a = (await tasks.create('member', { assistantId })).task
    const first = await files.upload('member', a.id, 'merge.txt', 'text/plain', Buffer.from('one'))
    const second = await files.upload('member', a.id, 'merge.txt', 'text/plain', Buffer.from('two'))
    await files.setInput('member', a.id, first.id, 'main')
    await files.setInput('member', a.id, second.id, 'reference')
    const db = drizzle(client)
    const before = (await db.select().from(taskInput)).find((item) => item.taskId === a.id && item.fileId === second.id)!
    await files.switchInputVersion('member', a.id, first.id, second.id)
    expect((await tasks.get(a.id)).inputs).toMatchObject([{ fileId: second.id, weight: 'main' }])
    expect((await db.select().from(taskInput)).find((item) => item.taskId === a.id && item.fileId === second.id)?.sortOrder).toBe(before.sortOrder)
    await files.setInput('member', a.id, first.id, 'reference')
    await files.switchInputVersion('member', a.id, first.id, second.id)
    expect((await tasks.get(a.id)).inputs).toMatchObject([{ fileId: second.id, weight: 'main' }])
  })

  it('queries only this task files once even when other tasks share tags', async () => {
    const a = (await tasks.create('member', { assistantId, tags: ['common'] })).task
    const b = (await tasks.create('member', { assistantId, tags: ['common'] })).task
    const own = await files.upload('member', a.id, 'mine.txt', 'text/plain', Buffer.from('x'))
    await files.upload('member', b.id, 'other.txt', 'text/plain', Buffer.from('y'))
    let queries = 0
    const counted = new DbFilesService(drizzle(client, { logger: { logQuery: () => { queries++ } } }), new FileStorageService(root), { fileMaxBytes: 1024, fileMaxPerRequest: 2 } as never)
    expect((await counted.filesForTask(a.id)).map((file) => file.id)).toEqual([own.id])
    expect(queries).toBe(1)
  })

  it('keeps the surviving chain connected when a middle version is soft deleted', async () => {
    const a = (await tasks.create('member', { assistantId })).task
    const first = await files.upload('member', a.id, 'chain.txt', 'text/plain', Buffer.from('one'))
    const middle = await files.upload('member', a.id, 'chain.txt', 'text/plain', Buffer.from('two'))
    const latest = await files.upload('member', a.id, 'chain.txt', 'text/plain', Buffer.from('three'))
    await files.remove(middle.id)
    expect((await files.versions(first.id)).map((file) => file.id)).toEqual([latest.id, first.id])
    expect((await files.candidates(a.id)).files.filter((item) => item.file.name === 'chain.txt').map((item) => item.file.id)).toEqual([latest.id])
  })
})
