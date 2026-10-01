import { describe, expect, it, vi } from 'vitest'
import { ReportsController } from './reports.controller.js'

describe('reports API', () => {
  it('기본 기간과 단위를 사용하고 잘못된 값은 거부한다', async () => {
    const get = vi.fn(async () => ({ buckets: [] }))
    const controller = new ReportsController({ get } as never)
    const req = { user: { id: 'member' } } as never
    await expect(controller.get(req)).resolves.toEqual({ buckets: [] })
    expect(get).toHaveBeenCalledWith(30, 'day', 'member', undefined)
    await expect(controller.get(req, '7', 'week')).resolves.toEqual({ buckets: [] })
    expect(get).toHaveBeenCalledWith(7, 'week', 'member', undefined)
    expect(() => controller.get(req, '0', 'day')).toThrow()
    expect(() => controller.get(req, '31.5', 'day')).toThrow()
    expect(() => controller.get(req, '30', 'month')).toThrow()
  })
})
