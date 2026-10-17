import { afterEach, expect, it, vi } from 'vitest'
import { OwuiTerminalCatalog } from './owuiTerminals.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const settings = { mode: 'live' as const, baseUrl: 'https://owui.example/api/', apiKey: 'service-key', model: 'm' }

it('caches only terminal IDs and names for five minutes and separates service credentials and OWUI hosts', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  let id = 'first'
  const fetcher = vi.fn(async () => Response.json([{ id, name: 'Code', url: 'https://private', key: 'secret', config: { auth: 'secret' } }]))
  vi.stubGlobal('fetch', fetcher)
  const catalog = new OwuiTerminalCatalog()
  expect(await catalog.list(settings)).toEqual([{ id: 'first', name: 'Code' }])
  id = 'second'
  now.mockReturnValue(1_000_000 + 5 * 60_000 - 1)
  expect(await catalog.list(settings)).toEqual([{ id: 'first', name: 'Code' }])
  expect(fetcher).toHaveBeenCalledTimes(1)
  now.mockReturnValue(1_000_000 + 5 * 60_000)
  expect(await catalog.list(settings)).toEqual([{ id: 'second', name: 'Code' }])
  id = 'other-account'
  expect(await catalog.list({ ...settings, apiKey: 'other' })).toEqual([{ id: 'other-account', name: 'Code' }])
  id = 'other-host'
  expect(await catalog.list({ ...settings, baseUrl: 'https://other.example' })).toEqual([{ id: 'other-host', name: 'Code' }])
  expect(fetcher).toHaveBeenCalledTimes(4)
  expect(fetcher.mock.calls[0]).toMatchObject(['https://owui.example/api/v1/terminals/', { headers: { Authorization: 'Bearer service-key' } }])
})

it.each([{}, [{ name: 'no id' }], [{ id: '' }], [{ id: 'bad\nid' }], [{ id: 'x'.repeat(201) }]])('rejects malformed terminal lists without caching them: %j', async body => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(body)).mockResolvedValueOnce(Response.json([{ id: 'valid' }]))
  vi.stubGlobal('fetch', fetcher)
  const catalog = new OwuiTerminalCatalog()
  await expect(catalog.list(settings)).rejects.toThrow('응답 형식 오류')
  expect(await catalog.list(settings)).toEqual([{ id: 'valid' }])
})

it('does not cache an access failure as an empty terminal list', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 403 })).mockResolvedValueOnce(Response.json([])))
  const catalog = new OwuiTerminalCatalog()
  await expect(catalog.list(settings)).rejects.toThrow('HTTP 403')
  expect(await catalog.list(settings)).toEqual([])
})
