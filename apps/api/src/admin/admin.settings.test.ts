import 'reflect-metadata'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'
import { afterEach, expect, it, vi } from 'vitest'
import { loadConfig } from '../config/config.js'
import { AdminSettingsController } from './admin.controller.js'
import { AdminService } from './admin.service.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('saves, replaces and clears only the global terminal setting through the real controller and service', async () => {
  const values = new Map<string, unknown>([['owuiTools', 'off']])
  const dialect = new MySqlDialect()
  const tx = {
    insert: () => ({ values: (row: { key: string; value: unknown }) => ({ onDuplicateKeyUpdate: async () => { values.set(row.key, row.value) } }) }),
    delete: () => ({ where: async (query: SQL) => { values.delete(String(dialect.sqlToQuery(query).params[0])) } }),
  }
  const db = { transaction: async (fn: (transaction: typeof tx) => Promise<void>) => fn(tx),
    select: () => ({ from: async () => [...values].map(([key, value]) => ({ key, value })) }) }
  const config = loadConfig({ APP_ORIGIN: 'http://localhost:5173', DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32) })
  const controller = new AdminSettingsController(new AdminService(db as never), config)
  expect(await controller.patch({ owuiDefaultTerminalId: ' first ' })).toMatchObject({ owuiDefaultTerminalId: 'first', owuiTools: 'off' })
  expect(await controller.patch({ owuiDefaultTerminalId: 'second' })).toMatchObject({ owuiDefaultTerminalId: 'second', owuiTools: 'off' })
  expect(await controller.patch({ owuiDefaultTerminalId: null })).not.toHaveProperty('owuiDefaultTerminalId')
  expect(await controller.get()).toMatchObject({ owuiTools: 'off' })
})

it('the admin catalog returns only IDs and names, caches the service account response and hides upstream errors', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ id: 'terminal', name: 'Code', url: 'https://private', key: 'secret' }]))
    .mockResolvedValueOnce(new Response('private details', { status: 403 }))
  vi.stubGlobal('fetch', fetcher)
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  const config = loadConfig({ APP_ORIGIN: 'http://localhost:5173', DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), LLM_MODE: 'live', LLM_PRESET: 'openwebui',
    LLM_BASE_URL: 'https://owui.example', LLM_API_KEY: 'service-key' })
  const controller = new AdminSettingsController({} as AdminService, config)
  expect(await controller.listTerminals()).toEqual([{ id: 'terminal', name: 'Code' }])
  expect(await controller.listTerminals()).toEqual([{ id: 'terminal', name: 'Code' }])
  expect(fetcher).toHaveBeenCalledTimes(1)
  now.mockReturnValue(1_300_000)
  await expect(controller.listTerminals()).rejects.toMatchObject({ status: 502, message: '터미널 목록을 불러오지 못했습니다.' })
})
