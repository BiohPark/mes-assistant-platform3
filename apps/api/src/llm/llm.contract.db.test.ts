import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createProvider } from '@mes/llm'
import { loadConfig } from '../config/config.js'
import { toLlmSettings } from './presets.js'

describe('fake OpenWebUI 계약', () => {
  let port: number
  let fakeServer: ChildProcess | undefined

  beforeAll(async () => {
    const reservation = createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('임시 포트를 할당할 수 없습니다')
    port = address.port
    await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()))

    fakeServer = spawn(process.execPath, [resolve(import.meta.dirname, '../../../../docker/fake-openwebui/server.mjs')], {
      env: { ...process.env, PORT: String(port) },
      shell: false,
      stdio: 'ignore',
    })

    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) })
        if (response.status === 200) return
      } catch { /* 서버 기동 대기 */ }
      await setTimeout(Math.min(100, Math.max(0, deadline - Date.now())))
    }
    throw new Error('fake OpenWebUI가 10초 안에 준비되지 않았습니다')
  })

  afterAll(() => fakeServer?.kill())

  it.each([
    ['openwebui', ''],
    ['openai-compatible', '/api'],
  ] as const)('%s 목록과 ping', async (preset, path) => {
    const baseUrl = `http://127.0.0.1:${port}${path}`
    const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32), APP_ORIGIN: 'http://localhost:5173', LLM_MODE: 'live', LLM_PRESET: preset, LLM_BASE_URL: baseUrl, LLM_API_KEY: 'dev-fake-key' })
    const provider = createProvider(toLlmSettings(config.llm))
    expect(await provider.listModels()).toEqual(['fake-general', 'fake-writer'])
    expect((await provider.ping()).ok).toBe(true)
  })
})
