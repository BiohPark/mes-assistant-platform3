import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import type { Pool } from 'mysql2/promise'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createPool } from '../db/connection.js'
import type { Db } from '../db/db.module.js'
import { runMigrations } from '../db/migrate.js'
import { seedCatalog } from '../db/seed.js'
import { appSetting, appUser, assistant, fileObject } from '../db/schema.js'
import { loadConfig } from '../config/config.js'
import { FileStorageService } from '../files/fileStorage.service.js'
import { createTempDb, MIGRATION_TEST_TIMEOUT_MS } from '../test/tempDb.js'
import { AdminService } from './admin.service.js'
import { DiagnosticsService } from './diagnostics.service.js'

let temp: Awaited<ReturnType<typeof createTempDb>>
let client: Pool
let db: Db
let root: string
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const upload = { originalname: 'character.png', mimetype: 'image/png', buffer: png, size: png.length }

beforeAll(async () => {
  temp = await createTempDb('storage_diag')
  await runMigrations(temp.url)
  client = createPool(temp.url)
  db = drizzle(client)
  await seedCatalog(db)
  await db.insert(appUser).values({ id: 'owner', name: 'Owner', initials: 'O', color: '#123456', isSystemOwner: true })
  root = await mkdtemp(join(tmpdir(), 'mes-storage-diag-'))
  await mkdir(join(root, 'config'))
  await writeFile(join(root, 'config/.env'), 'FILE_STORAGE_ROOT=./storage\n')
}, MIGRATION_TEST_TIMEOUT_MS)

afterAll(async () => {
  await client?.end()
  await temp?.drop()
  if (root) await rm(root, { recursive: true, force: true })
})

it('cwd가 달라져도 재시작 후 캐릭터·에이전트 이미지가 남고 실제 파일 누락만 경고한다', async () => {
  const env = { DATABASE_URL: temp.url, APP_ORIGIN: 'http://localhost:8080', SESSION_SECRET: 'x'.repeat(32), FILE_STORAGE_ROOT: './storage' }
  const options = { appRoot: root, execArgv: [`--env-file-if-exists=${join(root, 'config/.env')}`] }
  const firstConfig = loadConfig(env, { ...options, cwd: join(root, 'apps/api') })
  const firstStorage = new FileStorageService(firstConfig.fileStorageRoot)
  const admin = new AdminService(db, firstStorage, firstConfig)
  const characterId = (await admin.assistantImage('owner', upload)).assistantImageFileId as string
  await admin.image('owner', 'urs-analyst', upload)
  const [agent] = await db.select().from(assistant).where(eq(assistant.id, 'urs-analyst'))
  expect(agent?.imageFileId).toBeTruthy()

  const config = loadConfig(env, { ...options, cwd: root })
  expect(config.fileStorageRoot).toBe(firstConfig.fileStorageRoot)
  expect(config.fileStorageRoot).toBe(resolve(root, 'config/storage'))
  const storage = new FileStorageService(config.fileStorageRoot)
  const diagnostics = new DiagnosticsService(config, client, { ping: async () => ({ ok: true, detail: '' }) } as never, db, storage)
  expect((await diagnostics.get()).storage.assistantImages).toEqual({ configured: 2, missing: 0, unreadable: 0 })
  const [character] = await db.select().from(fileObject).where(eq(fileObject.id, characterId))
  expect(Buffer.from(await storage.read(character!.storageKey)).equals(png)).toBe(true)
  await storage.remove(character!.storageKey)
  expect((await diagnostics.get()).storage.assistantImages).toEqual({ configured: 2, missing: 1, unreadable: 0 })
  expect((await db.select().from(appSetting).where(eq(appSetting.key, 'assistantImageFileId')))[0]?.value).toBe(characterId)
  expect((await db.select().from(fileObject).where(eq(fileObject.id, characterId)))[0]?.deletedAt).toBeNull()

  const [agentFile] = await db.select().from(fileObject).where(eq(fileObject.id, agent!.imageFileId!))
  await storage.remove(agentFile!.storageKey)
  expect((await diagnostics.get()).storage.assistantImages).toEqual({ configured: 2, missing: 2, unreadable: 0 })
})
