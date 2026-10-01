import { describe, expect, it, vi } from 'vitest'
import { ReportsController } from './reports.controller.js'

describe('reports API', () => {
  it('기본 기간과 단위를 사용하고 잘못된 값은 거부한다', async () => {
    const get = vi.fn(async () => ({ buckets: [] }))
    const controller = new ReportsController({ get } as never)
    await expect(controller.get()).resolves.toEqual({ buckets: [] })
    expect(get).toHaveBeenCalledWith(30, 'day', undefined)
    await expect(controller.get('7', 'week')).resolves.toEqual({ buckets: [] })
    expect(get).toHaveBeenCalledWith(7, 'week', undefined)
    expect(() => controller.get('0', 'day')).toThrow()
    expect(() => controller.get('31.5', 'day')).toThrow()
    expect(() => controller.get('30', 'month')).toThrow()
  })
})
