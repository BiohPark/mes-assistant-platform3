import 'reflect-metadata'
import { afterEach, expect, it, vi } from 'vitest'
import { loadConfig } from '../config/config.js'
import { DiagnosticsService } from './diagnostics.service.js'

afterEach(() => vi.unstubAllGlobals())

it('reads the global terminal setting for access checks and trial calls, preserving the source through the response schema', async () => {
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'm' }] })
    if (url.endsWith('/terminals/')) return Response.json([{ id: 'chosen', url: 'https://terminal.private', key: 'secret' }, { id: 'other' }])
    if (url.endsWith('/chat/completions')) { bodies.push(JSON.parse(String(init?.body))); return new Response('data: [DONE]\n\n') }
    return new Response('', { status: 404 })
  }))
  const config = loadConfig({ APP_ORIGIN: 'http://localhost:5173', DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32),
    LLM_MODE: 'live', LLM_PRESET: 'openwebui', LLM_BASE_URL: 'https://diagnostics.example', LLM_API_KEY: 'service-key' })
  const db = { select: () => ({ from: () => ({ where: async () => [{ value: 'chosen' }] }) }) }
  const requests = { admit: async () => () => undefined, runAuxiliary: async (_actor: string, _kind: string, run: (signal: AbortSignal) => Promise<unknown>) => run(new AbortController().signal) }
  const service = new DiagnosticsService(config, {} as never, requests as never, db as never, {} as never)
  const access = await service.checkOpenWebUiAccess('m')
  expect(access.meta).toMatchObject({ terminalSource: 'global' })
  expect(bodies).toEqual([])
  const probe = await service.probeOpenWebUi('owner', 'm')
  expect(probe.meta).toMatchObject({ terminalSource: 'global' })
  expect(bodies).toHaveLength(3)
  expect(bodies[0]).not.toHaveProperty('terminal_id')
  for (const body of bodies.slice(1)) expect(body).toHaveProperty('terminal_id', 'chosen')
  expect(JSON.stringify({ access, probe })).not.toMatch(/chosen|terminal.private|secret|service-key/)
})

it.each([
  { terminals: ['only'], global: null, source: 'single', id: 'only' },
  { terminals: ['one', 'two'], global: null, source: 'none', id: undefined },
  { terminals: [], global: null, source: 'none', id: undefined },
])('without a model or global terminal, diagnostics reports $source and trial calls use the same selection ($terminals)', async ({ terminals, global, source, id }) => {
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'm', info: { meta: {} } }] })
    if (url.endsWith('/terminals/')) return Response.json(terminals.map(id => ({ id })))
    if (url.endsWith('/chat/completions')) { bodies.push(JSON.parse(String(init?.body))); return new Response('data: [DONE]\n\n') }
    return new Response('', { status: 404 })
  }))
  const config = loadConfig({ APP_ORIGIN: 'http://localhost:5173', DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32),
    LLM_MODE: 'live', LLM_PRESET: 'openwebui', LLM_BASE_URL: `https://${source}-${terminals.length}.example`, LLM_API_KEY: 'service-key' })
  const db = { select: () => ({ from: () => ({ where: async () => global ? [{ value: global }] : [] }) }) }
  const requests = { admit: async () => () => undefined, runAuxiliary: async (_actor: string, _kind: string, run: (signal: AbortSignal) => Promise<unknown>) => run(new AbortController().signal) }
  const service = new DiagnosticsService(config, {} as never, requests as never, db as never, {} as never)
  expect((await service.checkOpenWebUiAccess('m')).meta).toMatchObject({ terminal: false, terminalSource: source })
  expect((await service.probeOpenWebUi('owner', 'm')).meta).toMatchObject({ terminal: false, terminalSource: source })
  expect(bodies).toHaveLength(3)
  expect(bodies[0]).not.toHaveProperty('terminal_id')
  for (const body of bodies.slice(1)) {
    if (id) expect(body).toHaveProperty('terminal_id', id)
    else expect(body).not.toHaveProperty('terminal_id')
  }
})
